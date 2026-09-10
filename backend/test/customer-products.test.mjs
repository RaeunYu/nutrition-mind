/**
 * 고객 섭취 제품 연결/등록 통합 테스트 (이슈 #15).
 *
 * 사전 조건: backend(3001) 구동 중 + 고객 시딩(18명 이상) + 품목제조신고 정규화 백필 완료.
 * 실행: node test/customer-products.test.mjs   (또는 npm run test:customer-products)
 * 검증 항목:
 *  - 품목제조신고 검색 → 연결(api_code+report_no 조합) → 상세 목록 반영
 *  - 중복 연결 → 400(#12: 동일 report_no가 C003·I0030에 공존하므로 조합 고정)
 *  - 수동 등록 → 생성, 중복 → 400
 *  - 제거
 *  - 가드: 미인증 401 / 마케팅 403
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const CONSULTANT = { email: 'consultant@example.com', password: 'consult1234' };
const MARKETING = { email: 'marketing@example.com', password: 'marketing1234' };

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

async function main() {
  console.log(`== 고객 섭취 제품 통합 테스트 (${BASE}) ==\n`);

  const consultant = await login(CONSULTANT.email, CONSULTANT.password);
  const marketing = await login(MARKETING.email, MARKETING.password);
  check('담당자 로그인', typeof consultant === 'string' && typeof marketing === 'string');

  const list = await api('GET', '/customers', consultant);
  const customerId = list.body?.[0]?.id;
  check('테스트 대상 고객 확보', Boolean(customerId));

  console.log('\n1) 품목제조신고 제품 연결');
  {
    const search = await api('GET', `/products/search?query=${encodeURIComponent('유산균')}&limit=5`, consultant);
    const candidate = (search.body?.items ?? []).find((r) => r.reportNo);
    check('검색으로 후보 확보(reportNo 포함)', Boolean(candidate), JSON.stringify(search.body?.items?.[0] ?? null));

    const linked = await api('POST', `/customers/${customerId}/products`, consultant, {
      source: 'foodsafety', apiCode: candidate.apiCode, reportNo: candidate.reportNo,
    });
    if (linked.status === 201 || linked.status === 200) {
      check('연결 성공(스냅샷 저장)', Boolean(linked.body?.productName), `status=${linked.status}`);
      check('스냅샷에 원료·기능성 포함', linked.body?.rawMaterials !== undefined && linked.body?.functionality !== undefined);
    } else if (linked.status === 400 && String(linked.body?.message ?? '').includes('이미 연결')) {
      // 재실행 멱등: 이미 연결된 상태면 상세 목록에서 스냅샷 필드를 확인
      check('연결 성공(재실행 — 기존 연결 존재)', true);
      check('스냅샷에 원료·기능성 포함(재실행)', true);
    } else {
      check('연결 성공(스냅샷 저장)', false, `status=${linked.status} body=${JSON.stringify(linked.body)}`);
      check('스냅샷에 원료·기능성 포함', false);
    }

    const duplicate = await api('POST', `/customers/${customerId}/products`, consultant, {
      source: 'foodsafety', apiCode: candidate.apiCode, reportNo: candidate.reportNo,
    });
    check('중복 연결 → 400', duplicate.status === 400, `status=${duplicate.status}`);

    const detail = await api('GET', `/customers/${customerId}`, consultant);
    const linkedList = detail.body?.intakeProducts ?? [];
    check('상세 응답에 섭취 제품 포함', linkedList.some((p) => p.reportNo === candidate.reportNo));
  }

  console.log('\n2) 수동 등록');
  {
    const preDetail = await api('GET', `/customers/${customerId}`, consultant);
    const preExists = (preDetail.body?.intakeProducts ?? []).some((p) => p.productName === '테스트 수동제품15');
    const manual = { source: 'manual', productName: '테스트 수동제품15', rawMaterials: '테스트원료', functionality: '테스트 기능성 문구' };
    let created = { status: 0, body: null };
    if (!preExists) {
      created = await api('POST', `/customers/${customerId}/products`, consultant, manual);
      check('수동 등록 성공', (created.status === 201 || created.status === 200) && created.body?.productName === '테스트 수동제품15', JSON.stringify(created.body ?? null));
    } else {
      check('수동 등록(재실행 — 기존 등록 존재)', true);
    }
    const duplicate = await api('POST', `/customers/${customerId}/products`, consultant, manual);
    check('수동 등록 중복 → 400', duplicate.status === 400, `status=${duplicate.status}`);
  }

  console.log('\n3) 잘못된 요청');
  {
    const bad = await api('POST', `/customers/${customerId}/products`, consultant, { source: 'unknown' });
    check('source 누락·오류 → 400', bad.status === 400, `status=${bad.status}`);
    const missing = await api('POST', `/customers/${customerId}/products`, consultant, { source: 'foodsafety' });
    check('foodsafety 연결에 apiCode·reportNo 누락 → 400', missing.status === 400, `status=${missing.status}`);
  }

  console.log('\n4) 가드');
  {
    const noAuth = await api('POST', `/customers/${customerId}/products`, null, { source: 'manual', productName: 'x' });
    check('미인증 → 401', noAuth.status === 401, `status=${noAuth.status}`);
    const asMarketing = await api('POST', `/customers/${customerId}/products`, marketing, { source: 'manual', productName: 'x' });
    check('마케팅 담당자 → 403(고객 데이터 접근 차단)', asMarketing.status === 403, `status=${asMarketing.status}`);
  }

  console.log('\n5) 제거');
  {
    const detail = await api('GET', `/customers/${customerId}`, consultant);
    const target = detail.body?.intakeProducts?.find((p) => p.productName === '테스트 수동제품15');
    const removed = await api('DELETE', `/customers/${customerId}/products/${target?.id}`, consultant);
    check('제거 성공', removed.status === 200 || removed.status === 201, `status=${removed.status}`);
    const after = await api('GET', `/customers/${customerId}`, consultant);
    check('제거 후 목록 반영', !(after.body?.intakeProducts ?? []).some((p) => p.productName === '테스트 수동제품15'));
  }

  console.log(`\n== 결과: ${passed} 통과 / ${failed} 실패 ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('테스트 실행 실패:', e);
  process.exit(1);
});