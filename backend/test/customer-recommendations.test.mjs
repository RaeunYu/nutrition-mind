/**
 * 성분 갭 기반 추천 제안 통합 테스트 (이슈 #17).
 *
 * 사전 조건: backend(3001) 구동 중 + 성분 마스터 시딩(17종) + 고객 시딩(18명 이상) + 갭 API(#16).
 * 실행: node test/customer-recommendations.test.mjs   (또는 npm run test:recommendations)
 * 검증 항목:
 *  - 관심 성분 지정 → 추천 생성(갭 성분 근거·스냅샷 포함) — 재생성 멱등
 *  - 상태 전이: proposed → accepted → decidedAt 기록
 *  - 잘못된 상태 값 → 400
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
  console.log(`== 추천 제안 통합 테스트 (${BASE}) ==\n`);

  const consultant = await login(CONSULTANT.email, CONSULTANT.password);
  const marketing = await login(MARKETING.email, MARKETING.password);
  check('담당자 로그인', typeof consultant === 'string' && typeof marketing === 'string');

  const list = await api('GET', '/customers', consultant);
  const customerId = list.body?.[0]?.id;
  check('테스트 대상 고객 확보', Boolean(customerId));

  console.log('\n1) 관심 성분 지정 + 추천 생성');
  {
    const ingredients = await api('GET', '/ingredients', consultant);
    const items = Array.isArray(ingredients.body) ? ingredients.body : ingredients.body?.items ?? [];
    const ids = items.slice(0, 3).map((i) => i.id);
    await api('PUT', `/customers/${customerId}/interests`, consultant, { ingredientIds: ids });

    const generated = await api('POST', `/customers/${customerId}/recommendations/generate`, consultant);
    check('추천 생성 성공', generated.status === 200 || generated.status === 201, `status=${generated.status}`);
    check('생성 건수·아이템 일관', generated.body?.created === (generated.body?.items?.length ?? -1), JSON.stringify(generated.body?.created));
    const first = generated.body?.items?.[0];
    if (first) {
      check('제안에 근거(성분·키워드·원료 텍스트) 포함', Boolean(first.ingredientName && first.evidenceKeyword && first.evidenceRawMaterial), JSON.stringify(first));
    } else {
      // 재실행 멱등: 새 제안이 없으면 기존 제안 목록으로 대체 검증
      const existing = await api('GET', `/customers/${customerId}/recommendations`, consultant);
      check('기존 제안 목록으로 근거 검증 대체', (existing.body?.items ?? []).length > 0, `rows=${(existing.body?.items ?? []).length}`);
    }

    const regenerated = await api('POST', `/customers/${customerId}/recommendations/generate`, consultant);
    check('재생성 성공', regenerated.status === 200 || regenerated.status === 201, `status=${regenerated.status}`);
    const recList = await api('GET', `/customers/${customerId}/recommendations`, consultant);
    const recItems = recList.body?.items ?? [];
    const triples = recItems.map((r) => `${r.ingredientId}#${r.apiCode}#${r.reportNo}`);
    const unique = new Set(triples);
    check('재생성 후 중복 제안 없음(유니크 인덱스 멱등)', triples.length === unique.size, `rows=${triples.length} unique=${unique.size}`);
  }

  console.log('\n2) 상태 전이(수용/보류)');
  {
    const list = await api('GET', `/customers/${customerId}/recommendations`, consultant);
    const target = (list.body?.items ?? []).find((r) => r.status === 'proposed');
    check('proposed 제안 존재', Boolean(target));
    if (target) {
      const accepted = await api('PATCH', `/customers/${customerId}/recommendations/${target.id}`, consultant, { status: 'accepted' });
      check('수용 → accepted + decidedAt 기록', accepted.status === 200 && accepted.body?.status === 'accepted' && Boolean(accepted.body?.decidedAt), JSON.stringify(accepted.body ?? null));
      const held = await api('PATCH', `/customers/${customerId}/recommendations/${target.id}`, consultant, { status: 'held' });
      check('보류로 재변경 가능', held.status === 200 && held.body?.status === 'held', JSON.stringify(held.body ?? null));
      const bad = await api('PATCH', `/customers/${customerId}/recommendations/${target.id}`, consultant, { status: 'auto-accept' });
      check('잘못된 상태 값 → 400(자동 수용 없음)', bad.status === 400, `status=${bad.status}`);
    }
  }

  console.log('\n3) 가드');
  {
    const noAuth = await api('POST', `/customers/${customerId}/recommendations/generate`, null);
    check('미인증 추천 생성 → 401', noAuth.status === 401, `status=${noAuth.status}`);
    const asMarketing = await api('GET', `/customers/${customerId}/recommendations`, marketing);
    check('마케팅 담당자 목록 → 403', asMarketing.status === 403, `status=${asMarketing.status}`);
  }

  console.log(`\n== 결과: ${passed} 통과 / ${failed} 실패 ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('테스트 실행 실패:', e);
  process.exit(1);
});