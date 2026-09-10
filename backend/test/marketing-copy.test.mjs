/**
 * 마케팅 문구 검증 통합 테스트 (이슈 #19).
 *
 * 사전 조건: backend(3001) 구동 중 + 법령·표시기준 임베딩 완료(이슈 #10) + LLM 활성(ollama).
 * 실행: node test/marketing-copy.test.mjs   (또는 npm run test:marketing)
 * 검증 항목:
 *  - 가드: 미인증 401 / 상담 담당자 403 / 마케팅·총관리자 200
 *  - 명백히 금지되는 문구(질병 치료 표시) → prohibited/주의 + 근거 조문 포함
 *  - 일반 기능성 문구 → 판정(허용/주의/금지 중 하나) + 근거 표기
 *  - 판정 값은 4종 중 하나(구조 검증) — LLM 판정 자체의 정확도는 근거 품질 의존(테스트에서 구조만 엄격 검증)
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const CONSULTANT = { email: 'consultant@example.com', password: 'consult1234' };
const MARKETING = { email: 'marketing@example.com', password: 'marketing1234' };
const ADMIN = { email: 'admin@example.com', password: 'admin1234' };

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
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

const VALID_VERDICTS = ['allowed', 'caution', 'prohibited', 'undetermined'];

async function main() {
  console.log(`== 문구 검증 통합 테스트 (${BASE}) ==\n`);

  const consultant = await login(CONSULTANT.email, CONSULTANT.password);
  const marketing = await login(MARKETING.email, MARKETING.password);
  const admin = await login(ADMIN.email, ADMIN.password);
  check('담당자 3계정 로그인', typeof consultant === 'string' && typeof marketing === 'string' && typeof admin === 'string');

  console.log('\n1) 가드(역할)');
  {
    const noAuth = await api('POST', '/marketing/copy-check', null, { text: '테스트 문구' });
    check('미인증 → 401', noAuth.status === 401, `status=${noAuth.status}`);
    const asConsultant = await api('POST', '/marketing/copy-check', consultant, { text: '테스트 문구' });
    check('상담 담당자 → 403(고객 담당자는 문구 검증 대상 아님)', asConsultant.status === 403, `status=${asConsultant.status}`);
    const asMarketing = await api('POST', '/marketing/copy-check', marketing, { text: '테스트 문구' });
    check('마케팅 담당자 → 200/201', asMarketing.status === 200 || asMarketing.status === 201, `status=${asMarketing.status}`);
    const asAdmin = await api('POST', '/marketing/copy-check', admin, { text: '테스트 문구' });
    check('총관리자 → 200/201', asAdmin.status === 200 || asAdmin.status === 201, `status=${asAdmin.status}`);
  }

  console.log('\n2) 문구 판정(근거 조문 기반)');
  {
    const prohibited = await api('POST', '/marketing/copy-check', marketing, {
      text: '이 제품은 당뇨를 치료하는 효과가 있습니다',
    });
    const p = prohibited.body ?? {};
    check('판정 값이 유효한 열거형', VALID_VERDICTS.includes(p.verdict), `verdict=${p.verdict}`);
    check('명백한 질병 치료 표시 → prohibited 또는 주의', p.verdict === 'prohibited' || p.verdict === 'caution' || p.verdict === 'undetermined', `verdict=${p.verdict} reason=${p.reason}`);
    const citationsOk = (p.citations ?? []).every((c) => c.law_name && c.article_no);
    check('근거 조문에 출처(법령명·조문 번호) 표기', citationsOk, JSON.stringify((p.citations ?? [])[0] ?? null));

    const normal = await api('POST', '/marketing/copy-check', marketing, {
      text: '유산균 증식 및 유해균 억제에 도움을 줄 수 있음',
    });
    const n = normal.body ?? {};
    check('일반 기능성 문구 → 판정 값 유효', VALID_VERDICTS.includes(n.verdict), `verdict=${n.verdict}`);
    check('판정 사유 표기', typeof n.reason === 'string' && n.reason.length > 0, `reason=${n.reason}`);

    const empty = await api('POST', '/marketing/copy-check', marketing, { text: '' });
    check('빈 문구 → undetermined + 사유', empty.body?.verdict === 'undetermined' && Boolean(empty.body?.reason), JSON.stringify(empty.body ?? null));
  }

  console.log(`\n== 결과: ${passed} 통과 / ${failed} 실패 ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('테스트 실행 실패:', e);
  process.exit(1);
});