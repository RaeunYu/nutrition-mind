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
import { CryptoService } from "../src/crypto.service";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const crypto = new CryptoService();

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

/** 가명 데모 고객 15명 — 개인식별 필드는 반드시 CryptoService 경유로 암호화 저장(ADR-0002, 이슈 #13). */
const DEMO_CUSTOMERS_PII: Array<{
  name: string;
  phone: string;
  email: string | null;
  memo: string | null;
  ingredients: string[];
}> = [
  { name: "김서연", phone: "010-1000-2001", email: "kimseoyeon@example.com", memo: "첫 상담 — 관심 성분: 비타민D", ingredients: ["비타민D"] },
  { name: "이준호", phone: "010-1000-2002", email: "leejunho@example.com", memo: null, ingredients: ["오메가3", "아연"] },
  { name: "박하늘", phone: "010-1000-2003", email: null, memo: "임산부 — 엽산 권고 상담", ingredients: ["엽산", "마그네슘"] },
  { name: "최도윤", phone: "010-1000-2004", email: "choi@example.com", memo: null, ingredients: ["프로바이오틱스"] },
  { name: "정하윤", phone: "010-1000-2005", email: "jung@example.com", memo: "수험생 — 눈 피로 관련 문의", ingredients: [] },
  { name: "강시우", phone: "010-1000-2006", email: null, memo: "운동량 많음 — 단백질 외 문의 없음", ingredients: ["마그네슘"] },
  { name: "윤서준", phone: "010-1000-2007", email: "yoon@example.com", memo: null, ingredients: ["비타민C"] },
  { name: "임지아", phone: "010-1000-2007", email: "lim@example.com", memo: "임신 준비 — 엽산·철분 문의", ingredients: ["엽산", "철분"] },
  { name: "오예린", phone: "010-1000-2008", email: null, memo: "피부 관련 문의", ingredients: [] },
  { name: "한지호", phone: "010-1000-2009", email: "han@example.com", memo: "야근 많음 — 피로 개선 문의", ingredients: ["비타민B군"] },
  { name: "손유나", phone: "010-1000-2010", email: null, memo: null, ingredients: ["프로바이오틱스", "비타민D"] },
  { name: "신동현", phone: "010-1000-2011", email: "shin@example.com", memo: "관절 문의 — 콜라겐 관심", ingredients: [] },
  { name: "문가온", phone: "010-1000-2012", email: null, memo: "수면 문제 — 멜라토닌 문의", ingredients: ["마그네슘"] },
  { name: "차은호", phone: "010-1000-2012", email: "cha@example.com", memo: null, ingredients: ["오메가3"] },
  { name: "조민서", phone: "010-1000-2013", email: null, memo: "성장기 자녀 — 어린이용 문의", ingredients: ["비타민D", "칼슘"] },
];

/**
 * 성분 마스터 초기 시딩 (이슈 #16) — 기존 고객 시딩 성분명 13종 + 확장 성분 4종(비타민A·콜라겐·멜라토닌·루테인).
 * synonyms·keywords는 쉼표 구분 텍스트. keywords는 원료명(식약처 원재료명) 매칭용이며
 * 매칭 시 성분명+동의어+키워드를 모두 사용한다(ingredient-mapping.service).
 * 키워드는 긴 형태 우선 나열(예: 비타민b12 → 비타민b1) — 부분일치 매칭에서 짧은 키워드 선매칭 방지.
 * 용어 주의: 성분(표준 성분명) ≠ 원료(식약처 원재료명 텍스트) — 혼용 금지(CONTEXT.md).
 */
const INGREDIENT_MASTER: Array<{ name: string; synonyms: string; keywords: string }> = [
  { name: "비타민D", synonyms: "비타민D3,콜레칼시페롤", keywords: "비타민d3,콜레칼시페롤" },
  { name: "오메가3", synonyms: "오메가-3", keywords: "DHA,EPA,어유,생선기름" },
  { name: "마그네슘", synonyms: "", keywords: "" },
  { name: "프로폴리스", synonyms: "브라질프로폴리스", keywords: "프로폴리스추출물,브라질프로폴리스" },
  { name: "아연", synonyms: "글루콘산아연", keywords: "zinc,글루콘산아연" },
  { name: "비타민C", synonyms: "아스코르브산", keywords: "아스코르브산" },
  { name: "키토산", synonyms: "", keywords: "" },
  { name: "가르시니아", synonyms: "가르시니아캄보지아", keywords: "가르시니아캄보지아,캄보지아" },
  { name: "프로바이오틱스", synonyms: "유산균", keywords: "유산균,비피두스,락토바실러스" },
  { name: "엽산", synonyms: "", keywords: "" },
  { name: "철분", synonyms: "", keywords: "iron,퓨마산철,환원철" },
  { name: "비타민B군", synonyms: "", keywords: "비타민b복합체,비타민b12,비타민b6,비타민b1,비타민b2,니아신,판토텐산" },
  { name: "비타민A", synonyms: "레티놀", keywords: "베타카로틴,레티놀" },
  { name: "칼슘", synonyms: "", keywords: "calcium,젖산칼슘" },
  { name: "콜라겐", synonyms: "콜라겐펩타드", keywords: "콜라겐펩타드,해양콜라겐,피쉬콜라겐" },
  { name: "멜라토닌", synonyms: "", keywords: "" },
  { name: "루테인", synonyms: "", keywords: "마리골드" },
];

/**
 * 암호화 저장으로 인해 DB UNIQUE·검색이 불가하므로, 복호화 비교로 기존 고객을 찾는다(멱등 시딩 기준).
 * 고객 수가 적은 데모 범위에서만 사용하는 O(n) 탐색이다.
 */
async function findCustomerByName(name: string): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    "SELECT id FROM customers WHERE name = $1",
    name,
  );
  return rows[0]?.id ?? null;
}

/** 가명 고객 1명을 암호화해 생성한다(INSERT — id는 DB 기본값 gen_random_uuid()). */
async function createCustomer(c: { name: string; phone: string; email: string | null; memo: string | null }): Promise<void> {
  const dek = crypto.generateDek();
  await prisma.$executeRawUnsafe(
    `INSERT INTO customers (key_slot, name, phone_enc, email_enc, memo_enc) VALUES ($1, $2, $3, $4, $5)`,
    crypto.wrapDek(dek),
    c.name,
    crypto.encryptField(c.phone, dek),
    crypto.encryptField(c.email, dek),
    crypto.encryptField(c.memo, dek),
  );
}

/** 기존 고객의 비어 있는 개인식별 필드를 보완한다(멱등 — null인 칼럼만 채움). */
async function fillMissingPii(customerId: string, c: { phone: string; email: string | null; memo: string | null }): Promise<void> {
  const row = await prisma.$queryRawUnsafe<Array<{ key_slot: string; phone_enc: string | null; email_enc: string | null; memo_enc: string | null }>>(
    "SELECT key_slot, phone_enc, email_enc, memo_enc FROM customers WHERE id = $1",
    customerId,
  );
  const dek = crypto.unwrapDek(row[0].key_slot);
  const updates: Array<[string, string | null]> = [];
  if (row[0].phone_enc === null && c.phone) updates.push(["phone_enc", crypto.encryptField(c.phone, dek)!]);
  if (row[0].email_enc === null && c.email) updates.push(["email_enc", crypto.encryptField(c.email, dek)!]);
  if (row[0].memo_enc === null && c.memo) updates.push(["memo_enc", crypto.encryptField(c.memo, dek)!]);
  for (const [column, value] of updates) {
    if (column === "phone_enc") await prisma.$executeRawUnsafe("UPDATE customers SET phone_enc = $1 WHERE id = $2", value, customerId);
    if (column === "email_enc") await prisma.$executeRawUnsafe("UPDATE customers SET email_enc = $1 WHERE id = $2", value, customerId);
    if (column === "memo_enc") await prisma.$executeRawUnsafe("UPDATE customers SET memo_enc = $1 WHERE id = $2", value, customerId);
  }
}

async function main() {
  // 성분 마스터 (이슈 #16) — 멱등 upsert(갱신 시 synonyms·keywords 정규화)
  for (const ing of INGREDIENT_MASTER) {
    await prisma.ingredient.upsert({
      where: { name: ing.name },
      update: { synonyms: ing.synonyms, keywords: ing.keywords },
      create: { name: ing.name, synonyms: ing.synonyms, keywords: ing.keywords },
    });
  }
  console.log(`✅ 성분 마스터 시딩: ${INGREDIENT_MASTER.length}종`);

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

  // 기존 3명(이미 암호화 백필 완료) — 성분 유지
  for (const { name, ingredients } of DEMO_CUSTOMERS) {
    const customerId = await findCustomerByName(name);
    if (customerId === null) {
      // 방어적 경로(이론상 도달하지 않음) — 평문 없이 암호화 생성
      await createCustomer({ name, phone: "", email: null, memo: null });
    }
    const id = (await findCustomerByName(name))!;
    for (const ingredientName of ingredients) {
      await prisma.customerIngredient.upsert({
        where: { customerId_ingredientName: { customerId: id, ingredientName } },
        update: {},
        create: { customerId: id, ingredientName },
      });
    }
    console.log(`✅ 고객 시딩: ${name} (성분 ${ingredients.length}개)`);
  }

  // 가명 데모 고객 15명 — 암호화 경유 생성(멱등: 복호화 비교로 기존 고객 재사용)
  let createdNew = 0;
  for (const c of DEMO_CUSTOMERS_PII) {
    const existing = await findCustomerByName(c.name);
    if (existing === null) {
      await createCustomer({ name: c.name, phone: c.phone, email: c.email, memo: c.memo });
      createdNew++;
    } else {
      await fillMissingPii(existing, { phone: c.phone, email: c.email, memo: c.memo });
    }
    for (const ingredientName of c.ingredients) {
      const id = (await findCustomerByName(c.name))!;
      await prisma.customerIngredient.upsert({
        where: { customerId_ingredientName: { customerId: id, ingredientName } },
        update: {},
        create: { customerId: id, ingredientName },
      });
    }
    console.log(`✅ 가명 고객 시딩: ${c.name} (성분 ${c.ingredients.length}개)`);
  }
  const total = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>("SELECT COUNT(*) AS n FROM customers");
  console.log(`✅ 고객 총 ${total[0].n}명 (신규 생성 ${createdNew}명)`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
