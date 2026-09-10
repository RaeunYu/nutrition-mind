/**
 * 상담 보조 챗봇 개인화 통합 테스트 (이슈 #18).
 *
 * 사전 조건: backend(3001) 구동 중 + 고객 시딩(18명 이상).
 * 실행: node test/chat-personalization.test.mjs   (또는 npm run test:chat)
 * 검증 항목:
 *  - customerId 지정 질의 → customerContext.applied=true + notices에 고객 컨텍스트 적용 표시
 *  - 고객 미선택 질의 → 기존 응답 구조 유지(회귀, customerContext.applied=false)
 *  - 존재하지 않는 customerId → 우아한 폴백(200, 적용=false, 사유 표기)
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const CONSULTANT = { email: 'consultant@example.com', password: 'consult1234' };

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

async function chat(token, body) {
  const res = await fetch(`${BASE}/chat/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

async function main() {
  console.log(`== 챗봇 개인화 통합 테스트 (${BASE}) ==\n`);

  const consultant = await login(CONSULTANT.email, CONSULTANT.password);
  check('담당자 로그인', typeof consultant === 'string');

  const list = await (await fetch(`${BASE}/customers`, { headers: { Authorization: `Bearer ${consultant}` } })).json();
  const customerId = list?.[0]?.id;
  check('테스트 대상 고객 확보', Boolean(customerId));

  console.log('\n1) 고객 컨텍스트 개인화');
  {
    const res = await chat(consultant, { question: '이 고객에게 추천할 수 있는 방향의 근거 조문을 알려줘', customerId });
    check('고객 지정 질의 → 200/201', res.status === 200 || res.status === 201, `status=${res.status}`);
    check('customerContext 적용', res.body?.customerContext?.applied === true && Boolean(res.body.customerContext.customerName), JSON.stringify(res.body?.customerContext ?? null));
    check('notices에 고객 컨텍스트 적용 표시', (res.body?.notices ?? []).some((n) => n.includes('고객 컨텍스트 적용')), JSON.stringify(res.body?.notices ?? []));
    const keys = Object.keys(res.body ?? {});
    check('응답 구조 유지(answer·llm·notices·sources·top1)', ['answer', 'llm', 'notices', 'sources', 'top1'].every((k) => keys.includes(k)), keys.join(','));
  }

  console.log('\n2) 회귀(고객 미선택 — 기존 동작)');
  {
    const res = await chat(consultant, { question: '건강기능식품 표시기준이 뭔가요?' });
    check('고객 미선택 질의 → 200/201', res.status === 200 || res.status === 201, `status=${res.status}`);
    check('customerContext 미적용', res.body?.customerContext?.applied === false, JSON.stringify(res.body?.customerContext ?? null));
    const keys = Object.keys(res.body ?? {});
    check('기존 응답 구조 유지', ['answer', 'llm', 'notices', 'sources', 'top1'].every((k) => keys.includes(k)), keys.join(','));
  }

  console.log('\n3) 존재하지 않는 고객(우아한 폴백)');
  {
    const res = await chat(consultant, { question: '영업 허가 절차는?', customerId: '00000000-0000-0000-0000-000000000000' });
    check('미존재 고객 → 200/201(일반 답변 폴백)', res.status === 200 || res.status === 201, `status=${res.status}`);
    check('customerContext 미적용 + 사유 표시', res.body?.customerContext?.applied === false && (res.body?.notices ?? []).some((n) => n.includes('찾을 수 없')), JSON.stringify(res.body?.notices ?? []));
  }

  console.log(`\n== 결과: ${passed} 통과 / ${failed} 실패 ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('테스트 실행 실패:', e);
  process.exit(1);
});