/**
 * 품목제조신고 제품 검색 API 통합 테스트 (이슈 #12).
 *
 * 사전 조건: backend(3001) 구동 중 + 정규화 칼럼 백필 완료
 * (db: foodsafety_rows C003·I0030 91,992건 product_name NOT NULL).
 * 실행: node test/products.test.mjs   (또는 npm run test:products)
 * 검증 항목:
 *  - 미인증 401 (담당자 로그인 필수 — 기존 보호 수준 유지)
 *  - 제품명 검색(field 기본 product): "비타민" 부분일치 + 응답 필드(제품명·원료명·기능성·신고번호)
 *  - 원료명 검색(field=rawMaterial): "유산균" 부분일치
 *  - 없는 키워드 → 빈 결과(total 0, items [])
 *  - 페이지네이션: limit·offset 동작 + total 일관성 + limit 기본 20
 *  - 파라미터 검증: query 누락·field 잘못된 값 → 400, limit 상한(100) 클램프
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

async function search(token, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/products/search?${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = res.status === 200 || res.status === 201 ? await res.json() : await res.text();
  return { status: res.status, body };
}

async function main() {
  console.log(`== 품목제조신고 제품 검색 통합 테스트 (${BASE}) ==\n`);

  const token = await login(CONSULTANT.email, CONSULTANT.password);
  check('로그인 성공(consultant)', typeof token === 'string' && token.length > 0);

  console.log('\n1) 인증 가드');
  {
    const noAuth = await search(null, { query: '비타민' });
    check('미인증 요청 → 401', noAuth.status === 401, `status=${noAuth.status}`);
  }

  console.log('\n2) 제품명 검색 (field 기본값 product)');
  {
    const r = await search(token, { query: '비타민' });
    const ok200 = r.status === 200;
    const b = r.body ?? {};
    check('검색 성공(200)', ok200, `status=${r.status} body=${String(r.body).slice(0, 200)}`);
    check('응답 필드 구조(query·field·total·limit·offset·items)', ok200 && ['query', 'field', 'total', 'limit', 'offset', 'items'].every((k) => k in b), JSON.stringify(Object.keys(b)));
    check('field 기본값 = product', b.field === 'product', `field=${b.field}`);
    check('제품명 부분일치(모든 결과에 "비타민" 포함)', ok200 && b.items.length > 0 && b.items.every((x) => String(x.productName).includes('비타민')), `total=${b.total}`);
    check('결과 항목에 원료명·기능성·신고번호 포함', ok200 && b.items.every((x) => 'rawMaterialName' in x && 'functionalityText' in x && 'reportNo' in x), JSON.stringify(b.items?.[0]));
  }

  console.log('\n3) 원료명 검색 (field=rawMaterial)');
  {
    const r = await search(token, { query: '유산균', field: 'rawMaterial' });
    const b = r.body ?? {};
    check('검색 성공(200) + 결과 존재', r.status === 200 && b.total > 0 && b.items.length > 0, `status=${r.status} total=${b.total}`);
    check('원료명 부분일치(모든 결과의 원료명에 "유산균" 포함)', r.status === 200 && b.items.every((x) => String(x.rawMaterialName ?? '').includes('유산균')), JSON.stringify(b.items?.[0]?.rawMaterialName ?? '').slice(0, 120));
  }

  console.log('\n4) 없는 키워드 → 빈 결과');
  {
    const r = await search(token, { query: '존재하지않는제품명키워드xyz', field: 'rawMaterial' });
    const b = r.body ?? {};
    check('검색 성공(200) + total 0 + 빈 items', r.status === 200 && b.total === 0 && Array.isArray(b.items) && b.items.length === 0, `status=${r.status} body=${JSON.stringify(b).slice(0, 200)}`);
  }

  console.log('\n5) 페이지네이션');
  {
    const page1 = await search(token, { query: '비타민', limit: 5, offset: 0 });
    const page2 = await search(token, { query: '비타민', limit: 5, offset: 5 });
    const b1 = page1.body ?? {};
    const b2 = page2.body ?? {};
    check('limit=5 적용', page1.status === 200 && b1.items.length === 5 && b1.limit === 5, `len=${b1.items?.length} limit=${b1.limit}`);
    check('offset=5 → 다른 5건', page2.status === 200 && b2.items.length === 5 && JSON.stringify(b1.items) !== JSON.stringify(b2.items), `total=${b2.total}`);
    check('total 페이지 간 일관', b1.total === b2.total, `p1=${b1.total} p2=${b2.total}`);
    // 같은 신고번호가 C003·I0030에 공존 가능(실데이터 특성) → 전체 항목 동일성으로 판정
    const p1ids = b1.items.map((x) => JSON.stringify(x));
    const p2ids = b2.items.map((x) => JSON.stringify(x));
    check('페이지 간 결과 미중복(전체 항목 기준)', p1ids.every((n) => !p2ids.includes(n)), '');

    const broad = await search(token, { query: '비타민' });
    const bb = broad.body ?? {};
    check('limit 기본값 20', broad.status === 200 && bb.limit === 20 && bb.items.length === 20 && bb.total > 20, `limit=${bb.limit} len=${bb.items?.length} total=${bb.total}`);
    check('limit 최대 100 클램프', (await search(token, { query: '비타민', limit: 1000 })).body?.limit === 100, '');
  }

  console.log('\n6) 파라미터 검증');
  {
    const noQuery = await search(token, {});
    check('query 누락 → 400', noQuery.status === 400, `status=${noQuery.status}`);

    const badField = await search(token, { query: '비타민', field: 'name' });
    check('field 잘못된 값 → 400', badField.status === 400, `status=${badField.status}`);

    const badLimit = await search(token, { query: '비타민', limit: 'abc' });
    check('limit 비숫자 → 400', badLimit.status === 400, `status=${badLimit.status}`);

    // 와일드카드 이스케이프: % _ 는 리터럴로 취급 → 와일드카드만 입력하면 빈 결과
    const wildcard = await search(token, { query: '%%' });
    check('와일드카드 문자 이스케이프(% 2개 → 빈 결과)', wildcard.status === 200 && wildcard.body?.total === 0, `total=${wildcard.body?.total}`);
  }

  console.log(`\n== 결과: ${passed} 통과 / ${failed} 실패 ==`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});