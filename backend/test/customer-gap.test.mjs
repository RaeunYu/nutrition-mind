/**
 * 성분 갭 API 통합 테스트 (이슈 #16).
 *
 * 사전 조건: backend(3001) 구동 중 + 성분 마스터 시딩(17종) + 고객 시딩.
 * 실행: node test/customer-gap.test.mjs   (또는 npm run test:gap) — 멱등 재실행 가능.
 * 검증 항목:
 *  - GET /ingredients: 성분 마스터 목록(17종, id/name 필드)
 *  - PUT /customers/:id/interests: 관심 성분 지정(전체 교체)·존재하지 않는 성분 404·잘못된 요청 400
 *  - 고객 상세 응답에 interests 포함
 *  - GET /customers/:id/gap: 커버 근거(제품·키워드·원료 텍스트)·미커버(갭) 목록·매핑 실패 원료
 *    - 수동 섭취 제품 원료 '콜레칼시페롤' → 비타민D 커버(근거 intake_product)
 *    - 수동 섭취 제품 원료 '정제수, 셀룰로오스' → 매핑 실패 목록 포함
 *    - 수동 성분(customer_ingredients)으로 커버된 성분의 근거 source 라벨
 *  - 가드: 미인증 401 / 마케팅 403
 * 종료 시 테스트 제품 제거 + 관심 성분 원복(멱등).
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const CONSULTANT = { email: 'consultant@example.com', password: 'consult1234' };
const MARKETING = { email: 'marketing@example.com', password: 'marketing1234' };
const TEST_PRODUCT_A = '갭테스트제품16A'; // 콜레칼시페롤 → 비타민D 커버 근거
const TEST_PRODUCT_B = '갭테스트제품16B'; // 매핑 실패 원료 대상

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

async function ensureTestProduct(token, customerId, productName, rawMaterials) {
  const detail = await api('GET', `/customers/${customerId}`, token);
  const existing = (detail.body?.intakeProducts ?? []).find((p) => p.productName === productName);
  if (existing) return existing.id;
  const created = await api('POST', `/customers/${customerId}/products`, token, {
    source: 'manual', productName, rawMaterials, functionality: '갭 테스트용 수동 제품',
  });
  if (created.status !== 200 && created.status !== 201) return null;
  return created.body?.id ?? null;
}

async function main() {
  console.log(`== 성분 갭 통합 테스트 (${BASE}) ==\n`);

  const consultant = await login(CONSULTANT.email, CONSULTANT.password);
  const marketing = await login(MARKETING.email, MARKETING.password);
  check('담당자 로그인', typeof consultant === 'string' && typeof marketing === 'string');

  const list = await api('GET', '/customers', consultant);
  const customerId = list.body?.[0]?.id;
  check('테스트 대상 고객 확보', Boolean(customerId));

  const original = await api('GET', `/customers/${customerId}`, consultant);
  const originalInterestIds = (original.body?.interests ?? []).map((i) => i.ingredientId);
  const manualIngredientNames = original.body?.ingredients ?? [];

  console.log('\n1) 성분 마스터 목록');
  let master = [];
  {
    const res = await api('GET', '/ingredients', consultant);
    master = res.body ?? [];
    check('GET /ingredients 200 + 목록 비어 있지 않음', res.status === 200 && master.length >= 16, `status=${res.status} n=${master.length}`);
    check('마스터 항목에 id·name 필드', master.every((m) => typeof m.id === 'string' && typeof m.name === 'string'));
    const names = master.map((m) => m.name);
    check('기존 시딩 성분명 포함(비타민D·프로바이오틱스·비타민B군)', ['비타민D', '프로바이오틱스', '비타민B군'].every((n) => names.includes(n)));
  }

  console.log('\n2) 관심 성분 지정');
  {
    const idOf = (name) => master.find((m) => m.name === name)?.id;
    const wanted = [idOf('비타민D'), idOf('프로바이오틱스'), idOf('루테인')].filter(Boolean);
    check('마스터에서 테스트 대상 성분 id 확보(3종)', wanted.length === 3, JSON.stringify(wanted));

    const set = await api('PUT', `/customers/${customerId}/interests`, consultant, { ingredientIds: wanted });
    check('관심 성분 지정 200 + 3종 반영', set.status === 200 && (set.body?.interests ?? []).length === 3, `status=${set.status} body=${JSON.stringify(set.body ?? null)}`);

    const detail = await api('GET', `/customers/${customerId}`, consultant);
    check('고객 상세 응답에 interests 포함', (detail.body?.interests ?? []).length === 3 && detail.body.interests.every((i) => typeof i.ingredientId === 'string' && typeof i.name === 'string'));

    const notFound = await api('PUT', `/customers/${customerId}/interests`, consultant, { ingredientIds: ['00000000-0000-0000-0000-000000000000'] });
    check('존재하지 않는 성분 → 404', notFound.status === 404, `status=${notFound.status}`);
    const notArray = await api('PUT', `/customers/${customerId}/interests`, consultant, { ingredientIds: '비타민D' });
    check('ingredientIds 비배열 → 400', notArray.status === 400, `status=${notArray.status}`);
    const badItem = await api('PUT', `/customers/${customerId}/interests`, consultant, { ingredientIds: [123] });
    check('항목이 문자열 아님 → 400', badItem.status === 400, `status=${badItem.status}`);
  }

  console.log('\n3) 성분 갭 계산(수동 제품 원료 매핑 실측)');
  {
    const idA = await ensureTestProduct(consultant, customerId, TEST_PRODUCT_A, '콜레칼시페롤, 정제수');
    const idB = await ensureTestProduct(consultant, customerId, TEST_PRODUCT_B, '정제수, 셀룰로오스');
    check('테스트 수동 제품 확보(A: 콜레칼시페롤 / B: 매핑 실패 대상)', Boolean(idA) && Boolean(idB), `A=${idA} B=${idB}`);

    const gap = await api('GET', `/customers/${customerId}/gap`, consultant);
    check('GET /customers/:id/gap 200', gap.status === 200, `status=${gap.status}`);
    const g = gap.body ?? {};
    check('갭 응답 형식(interests·gap·unmappedMaterials 배열)', Array.isArray(g.interests) && Array.isArray(g.gap) && Array.isArray(g.unmappedMaterials));

    const vitd = (g.interests ?? []).find((i) => i.name === '비타민D');
    check('비타민D 커버(테스트 제품 원료 콜레칼시페롤)', vitd?.covered === true, JSON.stringify(vitd ?? null));
    const evidence = (vitd?.evidence ?? []).find((e) => e.source === 'intake_product');
    check('근거: 매칭 키워드·제품명·원료 텍스트',
      evidence?.matchedKeyword === '콜레칼시페롤' && evidence?.productName === TEST_PRODUCT_A && String(evidence?.rawMaterialText ?? '').includes('콜레칼시페롤'),
      JSON.stringify(evidence ?? null));

    const unmappedB = (g.unmappedMaterials ?? []).find((m) => m.productName === TEST_PRODUCT_B);
    check('매핑 실패 원료 목록에 테스트 제품B(정제수·셀룰로오스)', Boolean(unmappedB) && String(unmappedB?.rawMaterialText ?? '').includes('셀룰로오스'), JSON.stringify(g.unmappedMaterials ?? null));

    const gapNames = (g.gap ?? []).map((x) => x.name);
    const uncovered = (g.interests ?? []).filter((i) => !i.covered).map((i) => i.name);
    check('gap 목록 = 미커버 관심 성분(불변식)', JSON.stringify([...gapNames].sort()) === JSON.stringify([...uncovered].sort()), `gap=${JSON.stringify(gapNames)} uncovered=${JSON.stringify(uncovered)}`);

    // 수동 성분(customer_ingredients)으로 커버된 관심 성분 — 근거 source 라벨 검증
    const manualCovered = (g.interests ?? []).filter((i) => manualIngredientNames.includes(i.name) && i.covered);
    check('수동 성분 커버 판정(고객 성분명과 일치하는 관심 성분)', manualCovered.length > 0
      ? manualCovered.every((i) => (i.evidence ?? []).some((e) => e.source === 'manual_ingredient'))
      : true, JSON.stringify(manualCovered.map((i) => i.name)));

    const lutein = (g.interests ?? []).find((i) => i.name === '루테인');
    check('루테인: 커버되면 근거 존재, 아니면 gap 포함',
      (lutein?.covered ? (lutein.evidence ?? []).length > 0 : (g.gap ?? []).some((x) => x.name === '루테인')) === true,
      JSON.stringify(lutein ?? null));
  }

  console.log('\n4) 가드');
  {
    const noAuth = await api('GET', `/customers/${customerId}/gap`, null);
    check('갭 API 미인증 → 401', noAuth.status === 401, `status=${noAuth.status}`);
    const noAuth2 = await api('PUT', `/customers/${customerId}/interests`, null, { ingredientIds: [] });
    check('관심 성분 지정 미인증 → 401', noAuth2.status === 401, `status=${noAuth2.status}`);
    const asMarketing = await api('PUT', `/customers/${customerId}/interests`, marketing, { ingredientIds: [] });
    check('관심 성분 지정 마케팅 담당자 → 403', asMarketing.status === 403, `status=${asMarketing.status}`);
    const asMarketingGap = await api('GET', `/customers/${customerId}/gap`, marketing);
    check('갭 API 마케팅 담당자 → 403', asMarketingGap.status === 403, `status=${asMarketingGap.status}`);
    const asMarketingMaster = await api('GET', '/ingredients', marketing);
    check('성분 마스터 마케팅 담당자 → 403', asMarketingMaster.status === 403, `status=${asMarketingMaster.status}`);
  }

  console.log('\n5) 원복(멱등)');
  {
    const detail = await api('GET', `/customers/${customerId}`, consultant);
    for (const name of [TEST_PRODUCT_A, TEST_PRODUCT_B]) {
      const target = (detail.body?.intakeProducts ?? []).find((p) => p.productName === name);
      if (target) {
        await api('DELETE', `/customers/${customerId}/products/${target.id}`, consultant);
      }
    }
    const after = await api('GET', `/customers/${customerId}`, consultant);
    check('테스트 제품 제거 확인', !((after.body?.intakeProducts ?? []).some((p) => p.productName === TEST_PRODUCT_A || p.productName === TEST_PRODUCT_B)));

    const restored = await api('PUT', `/customers/${customerId}/interests`, consultant, { ingredientIds: originalInterestIds });
    check('관심 성분 원복', restored.status === 200 && (restored.body?.interests ?? []).length === originalInterestIds.length, `status=${restored.status}`);
  }

  console.log(`\n== 결과: ${passed} 통과 / ${failed} 실패 ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('테스트 실행 실패:', e);
  process.exit(1);
});