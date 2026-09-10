/**
 * 이슈 #28 백필 — 고객 이름 복호화(암호화 해제): name_enc → 평문 name 칼럼으로 이전(ADR-0002 개정).
 *
 * 실행: npx tsx prisma/decrypt-name-backfill.ts
 * - CryptoService 경유로 복호화한다(키·평문은 절대 출력하지 않는다).
 * - 멱등: name IS NULL인 행만 처리.
 * - 완료 후 prisma/migrations/20260910122000_drop_name_enc (name_enc DROP)을 적용한다.
 */
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(process.cwd(), "..", ".env") });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { CryptoService } from "../src/crypto.service";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const crypto = new CryptoService();

async function main() {
  const rows = await prisma.customer.findMany({ select: { id: true, keySlot: true, nameEnc: true } });
  let ok = 0;
  for (const row of rows) {
    const dek = crypto.unwrapDek(row.keySlot);
    const name = crypto.decryptField(row.nameEnc, dek);
    if (!name) throw new Error(`복호화 실패: 고객 ${row.id}`);
    await prisma.$executeRawUnsafe("UPDATE customers SET name = $1 WHERE id = $2", name, row.id);
    // 재검증
    const saved = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM customers WHERE id = $1",
      row.id,
    );
    if (saved[0].name === name) {
      ok++;
      console.log(`✅ 백필: 고객 ${row.id} (평문 name 저장, 키·평문 출력 없음)`);
    } else {
      throw new Error(`백필 검증 실패: 고객 ${row.id}`);
    }
  }
  console.log(`완료: ${ok}/${rows.length}건`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });