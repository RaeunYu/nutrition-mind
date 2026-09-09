/**
 * 데모 시딩 (Prisma 스크립트) — 역할 3종 + 데모 계정 + 고객:성분 1:N.
 * 실행: npx prisma db seed
 * 멱등(upsert)하므로 재실행해도 안전. 대용량 CSV 적재는 제외(ingest/load_foodsafety_csv.py 사용).
 */
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import * as bcrypt from "bcryptjs";

// 프로젝트 루트(backend의 상위) .env 로드
loadEnv({ path: resolve(process.cwd(), "..", ".env") });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** 역할 3종 (CONTEXT.md 용어 기준 — 코드는 Role 테이블 role_id) */
const DEMO_ROLES: Array<{ roleId: string; label: string }> = [
  { roleId: "admin", label: "총관리자" },
  { roleId: "consultant", label: "영업·상담 담당자" },
  { roleId: "marketing", label: "제품기획·마케팅 담당자" },
];

/** 역할별 데모 계정 — 비밀번호는 공개 데모 값(README에도 기재). bcrypt 해시로 저장. */
const DEMO_USERS: Array<{ email: string; password: string; roleId: string }> = [
  { email: "admin@example.com", password: "admin1234", roleId: "admin" },
  { email: "consultant@example.com", password: "consult1234", roleId: "consultant" },
  { email: "marketing@example.com", password: "marketing1234", roleId: "marketing" },
  // 기존 데모 계정(demo@example.com): 영업·상담 담당자 역할 부여 + 실제 해시로 갱신
  { email: "demo@example.com", password: "demo1234", roleId: "consultant" },
];

const DEMO_CUSTOMERS: Array<{ name: string; ingredients: string[] }> = [
  { name: "김건강", ingredients: ["비타민D", "오메가3", "마그네슘"] },
  { name: "이면역", ingredients: ["프로폴리스", "아연", "비타민C"] },
  { name: "박다이어트", ingredients: ["키토산", "가르시니아", "프로바이오틱스"] },
];

async function main() {
  for (const { roleId, label } of DEMO_ROLES) {
    await prisma.role.upsert({
      where: { roleId },
      update: { label },
      create: { roleId, label },
    });
    console.log(`✅ 역할 시딩: ${roleId} (${label})`);
  }

  for (const { email, password, roleId } of DEMO_USERS) {
    const passwordHash = bcrypt.hashSync(password, 10);
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, roleId }, // 재실행 시 데모 비밀번호·역할로 정규화(구 dev-only-hash 수복)
      create: { email, passwordHash, roleId },
    });
    console.log(`✅ 데모 계정 시딩: ${email} (${roleId}, bcrypt 해시)`);
  }

  for (const { name, ingredients } of DEMO_CUSTOMERS) {
    const customer = await prisma.customer.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    for (const ingredientName of ingredients) {
      await prisma.customerIngredient.upsert({
        where: { customerId_ingredientName: { customerId: customer.id, ingredientName } },
        update: {},
        create: { customerId: customer.id, ingredientName },
      });
    }
    console.log(`✅ 고객 시딩: ${name} (성분 ${ingredients.length}개)`);
  }
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
