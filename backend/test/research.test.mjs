/**
 * 기능성·원료 리서치 조회 통합 테스트 (이슈 #20).
 *
 * 사전 조건: backend(3001) 구동 중 + 원료형 정규화 마이그레이션(I-0040·I-0050) 완료.
 * 실행: node test/research.test.mjs   (또는 npm run test:research)
 * 검증 항목:
 *  - 원료명 검색(field=rawMaterial)이 제품+원료(I-0040·I-0050)를 모두 검색한다
 *  - 원료형 행에 기능성·1일 섭취량·주의사항(intake_note)이 포함된다
 *  - 가드: 미인증 401 / 마케팅·총관리자 200
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

async function api(method, path, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const parsed = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

async function main() {
  console.log(`== 리서치 조회 통합 테스트 (${BASE}) ==\n`);

  const consultant = await login(CONSULTANT.email, CONSULTANT.password);
  const marketing = await login(MARKETING.email, MARKETING.password);
  const admin = await login(ADMIN.email, ADMIN.password);
  check('담당자 3계정 로그인', typeof consultant === 'string' && typeof marketing === 'string' && typeof admin === 'string');

  console.log('\n1) 원료형 행 검색(개별인정 원료 I-0040)');
  {
    const res = await api('GET', `/products/search?query=${encodeURIComponent('금사상황버섯')}&field=rawMaterial&limit=5`, marketing);
    check('원료명 검색 → 원료형 행 포함', res.body?.total >= 1 && res.body.items.some((r) => r.apiCode === 'I-0040'), `total=${res.body?.total}`);
    const row = (res.body?.items ?? []).find((r) => r.apiCode === 'I-0040');
    check('기능성 문구 포함', Boolean(row?.functionalityText), JSON.stringify(row?.functionalityText ?? null));
    check('1일 섭취량·주의사항(intake_note) 포함', Boolean(row?.intakeNote) && row.intakeNote.includes('/'), JSON.stringify(row?.intakeNote ?? null));
  }

  console.log('\n2) 제품형 검색 회귀(C003·I0030)');
  {
    const res = await api('GET', `/products/search?query=${encodeURIComponent('유산균')}&field=product&limit=5`, consultant);
    check('제품명 검색 → 결과 존재', res.body?.total > 0, `total=${res.body?.total}`);
    check('제품형 행에 intake_note(섭취방법) 포함', (res.body.items ?? []).every((r) => r.intakeNote !== undefined), 'intake_note 필드 노출 확인');
  }

  console.log('\n3) 가드');
  {
    const noAuth = await api('GET', '/products/search?query=x&field=product', null);
    check('미인증 → 401', noAuth.status === 401, `status=${noAuth.status}`);
    const asMarketing = await api('GET', '/products/search?query=x&field=product', marketing);
    check('마케팅 담당자 → 200/201', asMarketing.status === 200 || asMarketing.status === 201, `status=${asMarketing.status}`);
    const asAdmin = await api('GET', '/products/search?query=x&field=product', admin);
    check('총관리자 → 200/201', asAdmin.status === 200 || asAdmin.status === 201, `status=${asAdmin.status}`);
  }

  console.log(`\n== 결과: ${passed} 통과 / ${failed} 실패 ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('테스트 실행 실패:', e);
  process.exit(1);
});