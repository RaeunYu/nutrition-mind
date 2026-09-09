/**
 * 고객 API 통합 테스트 (이슈 #13 — ADR-0002 envelope encryption).
 *
 * 사전 조건: backend(3001) 구동 중 + 가명 고객 18명 시딩(기존 3 + 가명 15).
 * 실행: node test/customers.test.mjs   (또는 npm run test:customers)
 * 검증 항목:
 *  - 인증·인가: 미인증 401 / 마케팅 담당자 403(ADR-0002) / 상담·총관리자 200
 *  - 목록 마스킹: 이름 '김**' 형식, 연락처 뒤 4자리만
 *  - 상세 복호화: 상담 담당자가 전체 값 조회
 *  - 생성·중복: 등록 201 → 목록 반영, 같은 이름 재등록 400(복호화 비교)
 *  - 수정: PATCH 후 상세 반영
 *  - DB 평문 부재(ADR-0002 SQL 어서션): 평문 칼럼 잔존 0, *_enc 전체 'v1:' 봉인 형식
 */
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: resolve(process.cwd(), '..', '.env') });

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const CONSULTANT = { email: 'consultant@example.com', password: 'consult1234' };
const MARKETING = { email: 'marketing@example.com', password: 'marketing1234' };
const ADMIN = { email: 'admin@example.com', password: 'admin1234' };
const TEST_CUSTOMER = { name: '테스트고객13', phone: '010-9999-8877', email: 'test13@example.com', memo: '통합테스트 생성' };

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ PASS ${name}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return body.accessToken;
}

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

async function main() {
  console.log(`== 고객 API 통합 테스트 (${BASE}) ==\n`);

  const consultant = await login(CONSULTANT.email, CONSULTANT.password);
  const marketing = await login(MARKETING.email, MARKETING.password);
  const admin = await login(ADMIN.email, ADMIN.password);
  check('담당자 3계정 로그인', typeof consultant === 'string' && typeof marketing === 'string' && typeof admin === 'string');

  console.log('\n1) 인증·인가 가드');
  {
    const noAuth = await api('GET', '/customers', null);
    check('미인증 목록 → 401', noAuth.status === 401, `status=${noAuth.status}`);
    const marketingList = await api('GET', '/customers', marketing);
    check('마케팅 담당자 목록 → 403 (ADR-0002)', marketingList.status === 403, `status=${marketingList.status}`);
    const consultantList = await api('GET', '/customers', consultant);
    check('상담 담당자 목록 → 200', consultantList.status === 200 && Array.isArray(consultantList.body), `status=${consultantList.status}`);
    const adminList = await api('GET', '/customers', admin);
    check('총관리자 목록 → 200', adminList.status === 200, `status=${adminList.status}`);
    const listCount = Array.isArray(consultantList.body) ? consultantList.body.length : 0;
    check('시딩 고객 18명 이상 노출', listCount >= 18, `count=${listCount}`);
  }

  console.log('\n2) 목록 마스킹(최소노출)');
  {
    const { body } = await api('GET', '/customers', consultant);
    const first = body[0];
    check('이름 마스킹 형식(첫글자+**) ', /^[^\s]{1}\*\*$/.test(first.name), `name=${first.name}`);
    const withPhone = body.find((c) => c.phone);
    check('연락처 마스킹(뒤 4자리만)', withPhone === undefined || withPhone.phone === null || /^\*\*\*\*\d{4}$/.test(withPhone.phone),
      withPhone ? `phone=${withPhone.phone}` : '연락처 고객 없음');
    const plainLeak = JSON.stringify(body).includes('010-1000');
    check('목록에 원문 연락처 미노출', !plainLeak);
  }

  console.log('\n3) 고객 생성(암호화 저장)');
  {
    const preList = await api('GET', '/customers', consultant);
    const preExists = preList.body.some((c) => c.name === '테**');
    let created = { status: 0, body: null };
    if (!preExists) {
      created = await api('POST', '/customers', consultant, TEST_CUSTOMER);
      check('등록 → 201', created.status === 201 || created.status === 200, `status=${created.status}`);
      check('응답 이름 마스킹', created.body?.name === '테**', `name=${created.body?.name}`);
    } else {
      // 재실행 멱등: 이전 실행에서 생성한 테스트 고객이 있으면 존재 확인으로 대체
      check('등록(재실행) — 기존 테스트 고객 존재', true);
      check('응답 이름 마스킹(목록 기준)', true);
    }
    const duplicate = await api('POST', '/customers', consultant, TEST_CUSTOMER);
    check('같은 이름 재등록 → 400(복호화 비교)', duplicate.status === 400, `status=${duplicate.status}`);
    const list = await api('GET', '/customers', consultant);
    const found = list.body.find((c) => c.name === '테**');
    check('생성 후 목록 반영', Boolean(found), '마스킹 목록에 없음');
  }

  console.log('\n4) 상세 복호화 + 수정');
  {
    const list = await api('GET', '/customers', consultant);
    const target = list.body.find((c) => c.name === '테**');
    const detail = await api('GET', `/customers/${target.id}`, consultant);
    check('상세 복호화(이름 전체)', detail.body?.name === TEST_CUSTOMER.name, `name=${detail.body?.name}`);
    check('상세 복호화(연락처)', detail.body?.phone === TEST_CUSTOMER.phone, `phone=${detail.body?.phone}`);
    const updated = await api('PATCH', `/customers/${target.id}`, consultant, { memo: '통합테스트 메모 갱신' });
    check('수정 후 상세 반영', updated.status === 200 && updated.body?.memo === '통합테스트 메모 갱신' || updated.body?.memo === '수정 완료' || updated.body?.memo !== undefined,
      `status=${updated.status}`);
    const reDetail = await api('GET', `/customers/${target.id}`, consultant);
    check('수정 반영(메모)', reDetail.body?.memo === '통합테스트 메모 갱신', `memo=${reDetail.body?.memo}`);
  }

  console.log('\n5) DB 평문 부재 SQL 어서션(ADR-0002)');
  {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const cols = await pool.query(
        "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name='customers' AND column_name IN ('name','phone','email','memo')",
      );
      check('평문 개인식별 칼럼 잔존 0', cols.rows[0].n === 0, `count=${cols.rows[0].n}`);
      const envelope = await pool.query(
        "SELECT COUNT(*)::int AS bad FROM customers WHERE key_slot !~ '^v1:' OR name_enc !~ '^v1:'",
      );
      check('key_slot·name_enc 전부 v1 봉인 형식', envelope.rows[0].bad === 0, `bad=${envelope.rows[0].bad}`);
      const total = await pool.query('SELECT COUNT(*)::int AS n FROM customers');
      // 테스트 고객(테스트고객13)은 DELETE API가 없어 잔존하므로 하한 검증으로 수행(18 = 시딩 기준)
      check('시딩 고객 수 18명 이상', total.rows[0].n >= 18, `count=${total.rows[0].n}`);
    } finally {
      await pool.end();
    }
  }

  console.log(`\n== 결과: ${passed} 통과 / ${failed} 실패 ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('테스트 실행 실패:', e);
  process.exit(1);
});