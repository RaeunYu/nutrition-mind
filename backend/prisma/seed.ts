/**
 * 데모 시딩 (Prisma 스크립트) — 고객:성분 1:N + 데모 사용자.
 * 실행: npx prisma db seed
 * 멱등(upsert)하므로 재실행해도 안전. 대용량 CSV 적재는 제외(ingest/load_foodsafety_csv.py 사용).
 */
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

// 프로젝트 루트(backend의 상위) .env 로드
loadEnv({ path: resolve(process.cwd(), "..", ".env") });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DEMO_CUSTOMERS: Array<{ name: string; ingredients: string[] }> = [
  { name: "김건강", ingredients: ["비타민D", "오메가3", "마그네슘"] },
  { name: "이면역", ingredients: ["프로폴리스", "아연", "비타민C"] },
  { name: "박다이어트", ingredients: ["키토산", "가르시니아", "프로바이오틱스"] },
];

async function main() {
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

  const email = process.env.DEMO_USER_EMAIL ?? "demo@example.com";
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: "dev-only-hash" },
  });
  console.log(`✅ 데모 사용자 시딩: ${email}`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
