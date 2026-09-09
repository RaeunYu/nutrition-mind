/**
 * 역할별 로그인 + 간소화 RBAC 통합 테스트 (이슈 #11).
 *
 * 사전 조건: backend(3001) 구동 중 + `npx prisma db seed` 실행 완료.
 * 실행: node test/rbac.test.mjs   (또는 npm run test:rbac)
 * 검증 항목:
 *  - 역할별 로그인 성공 + JWT role 클레임 확인
 *  - 잘못된 비밀번호/미등록 계정/빈 입력 거부
 *  - /customers 가드: 미인증 401, 마케팅 403, 상담·총관리자 200
 *  - 회귀: /chat/chat 이 기존 응답 구조(answer, sources)를 유지하는지
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3001';

const DEMO_USERS = [
  { email: 'admin@example.com', password: 'admin1234', role: 'admin' },
  { email: 'consultant@example.com', password: 'consult1234', role: 'consultant' },
  { email: 'marketing@example.com', password: 'marketing1234', role: 'marketing' },
  { email: 'demo@example.com', password: 'demo1234', role: 'consultant' },
];

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

/** JWT payload(base64url) 디코드 — role 클레임 검증용 */
function decodeJwtPayload(token) {
  const part = String(token).split('.')[1];
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  console.log(`== 역할·RBAC 통합 테스트 (${BASE}) ==\n`);

  console.log('1) 로그인: 역할 부여·JWT role 클레임');
  const tokens = {};
  for (const u of DEMO_USERS) {
    const { status, body } = await login(u.email, u.password);
    // NestJS POST 기본 상태코드는 201 (기존 /auth/login과 동일 — 응답 본문으로 판정)
    const ok = (status === 200 || status === 201) && body.ok === true && body.role === u.role && typeof body.accessToken === 'string';
    let claim = null;
    if (body.accessToken) {
      claim = decodeJwtPayload(body.accessToken).role ?? null;
    }
    check(`${u.email} 로그인 성공(역할 ${u.role})`, ok, `status=${status} body=${JSON.stringify(body)}`);
    check(`${u.email} JWT role 클레임 = ${u.role}`, claim === u.role, `claim=${claim}`);
    tokens[u.role] = body.accessToken;
  }

  console.log('\n2) 로그인 거부 케이스');
  {
    const { body } = await login('consultant@example.com', 'wrong-password');
    check('잘못된 비밀번호 거부', body.ok === false, JSON.stringify(body));
    const { body: b2 } = await login('nobody@example.com', 'whatever');
    check('미등록 계정 거부', b2.ok === false, JSON.stringify(b2));
    const { body: b3 } = await login('', '');
    check('빈 입력 거부', b3.ok === false, JSON.stringify(b3));
  }

  console.log('\n3) /customers 역할 가드 (고객 개인정보 — ADR-0001)');
  {
    const noAuth = await fetch(`${BASE}/customers`);
    check('미인증 요청 → 401', noAuth.status === 401, `status=${noAuth.status}`);

    const marketing = await fetch(`${BASE}/customers`, {
      headers: { Authorization: `Bearer ${tokens.marketing}` },
    });
    check('마케팅 담당자 → 403 거부', marketing.status === 403, `status=${marketing.status}`);

    const consultant = await fetch(`${BASE}/customers`, {
      headers: { Authorization: `Bearer ${tokens.consultant}` },
    });
    const consultantBody = consultant.status === 200 ? await consultant.json() : null;
    check('상담 담당자 → 200 + 목록 조회', consultant.status === 200 && Array.isArray(consultantBody), `status=${consultant.status}`);
    check('고객 목록에 성분 포함(기존 AC9 응답 유지)', Array.isArray(consultantBody) && consultantBody[0]?.ingredients?.length >= 0, JSON.stringify(consultantBody?.[0]?.name ?? ''));

    const admin = await fetch(`${BASE}/customers`, {
      headers: { Authorization: `Bearer ${tokens.admin}` },
    });
    check('총관리자 → 200 (운영 확인 허용)', admin.status === 200, `status=${admin.status}`);
  }

  console.log('\n4) 회귀 확인: /chat/chat 기존 동작 유지');
  {
    const res = await fetch(`${BASE}/chat/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.consultant}` },
      body: JSON.stringify({ question: '건강기능식품 영업 허가 절차를 알려줘' }),
    });
    const body = await res.json();
    check(
      '챗봇 응답 구조 유지(answer·sources)',
      (res.status === 200 || res.status === 201) && typeof body.answer === 'string' && body.answer.length > 0 && typeof body.sources === 'number',
      `status=${res.status} keys=${Object.keys(body).join(',')}`,
    );
  }

  console.log(`\n== 결과: ${passed} 통과 / ${failed} 실패 ==`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});