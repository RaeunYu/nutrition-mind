/**
 * 이슈 #13 백필 — 기존 customers 행의 평문 name을 암호화 칼럼(name_enc)으로 이전 (ADR-0002).
 *
 * 실행: npx tsx prisma/encrypt-customer-backfill.ts
 * - 반드시 암호화 서비스(CryptoService) 경로로 암호화한다(직접 암호화 우회 금지).
 * - 멱등: key_slot IS NULL인 행만 처리 → 재실행 0건 갱신.
 * - 백필 확인 후 평문 name 칼럼 제거는 별도 SQL(psql -f)로 수행한다.
 * - 키·암호문 값은 절대 출력하지 않는다.
 */
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

// 프로젝트 루트(backend의 상위) .env 로드
loadEnv({ path: resolve(process.cwd(), "..", ".env") });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { CryptoService } from "../src/crypto.service";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const crypto = new CryptoService();

async function main() {
  const pending = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    "SELECT id, name FROM customers WHERE key_slot IS NULL",
  );
  console.log(`백필 대상 행: ${pending.length}건 (key_slot 미보유)`);

  let okCount = 0;
  for (const row of pending) {
    // 1) 고객별 DEK 발급 → KEK로 wrap → key_slot
    const dek = crypto.generateDek();
    const keySlot = crypto.wrapDek(dek);
    // 2) 평문 name을 DEK로 암호화 → name_enc
    const nameEnc = crypto.encryptField(row.name, dek);
    await prisma.$executeRawUnsafe(
      "UPDATE customers SET key_slot = $1, name_enc = $2 WHERE id = $3",
      keySlot, nameEnc, row.id,
    );

    // 3) 저장된 값 다시 읽어 복호화 일치 검증(백필 무결성)
    const saved = await prisma.$queryRawUnsafe<Array<{ key_slot: string; name_enc: string }>>(
      "SELECT key_slot, name_enc FROM customers WHERE id = $1",
      row.id,
    );
    const dekBack = crypto.unwrapDek(saved[0].key_slot);
    const decrypted = crypto.decryptField(saved[0].name_enc, dekBack);
    if (decrypted === row.name) {
      okCount++;
      console.log(`✅ 백필+검증 완료: 고객 ${row.id} (복호화 일치)`);
    } else {
      throw new Error(`백필 검증 실패: 고객 ${row.id} — 복호화 결과가 원본과 불일치`);
    }
  }

  const remaining = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    "SELECT COUNT(*) AS n FROM customers WHERE key_slot IS NULL OR name_enc IS NULL",
  );
  console.log(`완료: ${okCount}/${pending.length}건 백필 · 미백필 잔존 ${remaining[0].n}건`);
  if (Number(remaining[0].n) !== 0) {
    throw new Error("미백필 행 잔존 — 마이그레이션 중단");
  }
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });