/**
 * 성분 매핑 서비스 단위 테스트 (이슈 #16 — 원료명 키워드 규칙 매핑, tdd).
 *
 * 실행: npx tsx test/ingredient-mapping.test.mjs  (또는 npm run test:mapping)
 * 검증 항목:
 *  - 정매칭 / 동의어 / 키워드 매칭
 *  - 대소문자·공백·하이픈 무시(정규화)
 *  - 다중 성분 추출, 여러 제품의 중복 성분 통합
 *  - 미매칭 원료 → 실패 목록 반환, 매칭된 텍스트는 실패 목록 제외
 *  - 근거(어떤 키워드가 매칭됐는지) 포함 — 마스터 원문 표기 보존
 *  - 수동 성분(customer_ingredients) 커버 라벨 구분
 *  - buildGapView: 관심 성분별 커버 여부 + 갭 목록
 */
// tsx로 실행되므로 TS 소스를 직접 임포트한다.
const svc = await import('../src/ingredient-mapping.service.ts');

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

/** 테스트용 성분 마스터(규칙) — 실제 시딩 마스터와 동일한 형식(name/synonyms/keywords, 쉼표 구분). */
const MASTER = [
  { id: 'ing-vitd', name: '비타민D', synonyms: '비타민D3,콜레칼시페롤', keywords: '비타민d3,콜레칼시페롤' },
  { id: 'ing-omega3', name: '오메가3', synonyms: '오메가-3', keywords: 'DHA,EPA,어유,생선기름' },
  { id: 'ing-probiotics', name: '프로바이오틱스', synonyms: '유산균', keywords: '유산균,비피두스,락토바실러스' },
  { id: 'ing-vitc', name: '비타민C', synonyms: '아스코르브산', keywords: '아스코르브산' },
  { id: 'ing-zinc', name: '아연', synonyms: '글루콘산아연', keywords: 'zinc,글루콘산아연' },
];

function findMatch(result, ingredientName) {
  return result.matches.find((m) => m.ingredientName === ingredientName) ?? null;
}

async function main() {
  console.log('== 성분 매핑 단위 테스트 (ingredient-mapping.service) ==\n');

  console.log('1) 정규화·키워드 전개');
  {
    check('normalize: 대소문자·공백·하이픈 무시', svc.normalizeText(' 비타민 D-3 ') === '비타민d3', JSON.stringify(svc.normalizeText(' 비타민 D-3 ')));
    const kws = svc.ruleKeywords(MASTER[2]); // 프로바이오틱스
    check('ruleKeywords: 성분명+동의어+키워드 결합·중복 제거',
      kws.length === 4 && kws.includes('프로바이오틱스') && kws.includes('유산균') && kws.includes('비피두스'),
      JSON.stringify(kws));
  }

  console.log('\n2) 단일 텍스트 매칭');
  {
    const r = svc.mapMaterials([{ productName: '제품A', rawMaterialText: '비타민D' }], MASTER);
    const m = findMatch(r, '비타민D');
    check('정매칭: 성분명 그대로', Boolean(m), JSON.stringify(r));
    check('정매칭: 근거 키워드=성분명', m?.evidence?.[0]?.matchedKeyword === '비타민D');

    const r2 = svc.mapMaterials([{ productName: '제품B', rawMaterialText: '콜레칼시페롤 300IU' }], MASTER);
    const m2 = findMatch(r2, '비타민D');
    check('동의어 매칭: 콜레칼시페롤 → 비타민D', Boolean(m2) && m2.evidence[0].matchedKeyword === '콜레칼시페롤', JSON.stringify(r2));

    const r3 = svc.mapMaterials([{ productName: '제품C', rawMaterialText: '유산균 발효물' }], MASTER);
    check('키워드 매칭: 유산균 → 프로바이오틱스', Boolean(findMatch(r3, '프로바이오틱스')), JSON.stringify(r3));

    const r4 = svc.mapMaterials([{ productName: '제품D', rawMaterialText: 'DHA 300MG, EPA' }], MASTER);
    const m4 = findMatch(r4, '오메가3');
    check('대소문자 무시: DHA/EPA → 오메가3', Boolean(m4) && m4.evidence[0].matchedKeyword === 'DHA', JSON.stringify(r4));

    const r5 = svc.mapMaterials([{ productName: '제품E', rawMaterialText: '비타민 D 1000IU' }], MASTER);
    check('공백 무시: "비타민 D" → 비타민D', Boolean(findMatch(r5, '비타민D')), JSON.stringify(r5));

    const r6 = svc.mapMaterials([{ productName: '제품F', rawMaterialText: '오메가-3' }], MASTER);
    check('하이픈 무시: "오메가-3" → 오메가3', Boolean(findMatch(r6, '오메가3')), JSON.stringify(r6));
  }

  console.log('\n3) 다중 성분·통합');
  {
    const r = svc.mapMaterials([{ productName: '제품G', rawMaterialText: '비타민C, 아연, 콜레칼시페롤' }], MASTER);
    check('다중 성분 추출(3종)', r.matches.length === 3, JSON.stringify(r.matches.map((m) => m.ingredientName)));
    check('매칭 순서는 마스터(규칙) 순서', r.matches.map((m) => m.ingredientName).join(',') === '비타민D,비타민C,아연', JSON.stringify(r.matches.map((m) => m.ingredientName)));

    const r2 = svc.mapMaterials([
      { productName: 'P1', rawMaterialText: '유산균' },
      { productName: 'P2', rawMaterialText: '비피두스' },
    ], MASTER);
    const m = findMatch(r2, '프로바이오틱스');
    check('여러 제품의 중복 성분 통합(근거 2건)', Boolean(m) && m.evidence.length === 2, JSON.stringify(m ?? r2));
    check('근거에 제품명·원료 텍스트 보존', m.evidence[0].productName === 'P1' && m.evidence[0].rawMaterialText === '유산균' && m.evidence[1].productName === 'P2');
  }

  console.log('\n4) 미매칭·실패 목록');
  {
    const r = svc.mapMaterials([{ productName: '제품H', rawMaterialText: '발효유고형분, 정제수' }], MASTER);
    check('미매칭: matches 비어 있음', r.matches.length === 0, JSON.stringify(r));
    check('미매칭: unmappedMaterials 반환(제품명·원료 텍스트)',
      r.unmappedMaterials.length === 1 && r.unmappedMaterials[0].productName === '제품H' && r.unmappedMaterials[0].rawMaterialText === '발효유고형분, 정제수',
      JSON.stringify(r.unmappedMaterials));

    const r2 = svc.mapMaterials([
      { productName: 'P-매칭', rawMaterialText: '정제수, 유산균, 비피두스' },
      { productName: 'P-실패', rawMaterialText: '정제수, 셀룰로오스' },
    ], MASTER);
    check('매칭 성공한 제품은 실패 목록 제외', r2.unmappedMaterials.length === 1 && r2.unmappedMaterials[0].productName === 'P-실패', JSON.stringify(r2.unmappedMaterials));
    check('혼합 텍스트에서 부분 매칭(유산균 → 프로바이오틱스)', Boolean(findMatch(r2, '프로바이오틱스')));

    const r3 = svc.mapMaterials([
      { productName: 'P-원료없음', rawMaterialText: null },
      { productName: 'P-빈텍스트', rawMaterialText: '   ' },
    ], MASTER);
    check('null·공백 원료 텍스트: 미매칭·실패 목록 모두 제외', r3.matches.length === 0 && r3.unmappedMaterials.length === 0, JSON.stringify(r3));

    const r4 = svc.mapMaterials([
      { productName: null, rawMaterialText: '비타민D', source: 'manual_ingredient' },
      { productName: null, rawMaterialText: '루테인', source: 'manual_ingredient' },
    ], MASTER);
    const m = findMatch(r4, '비타민D');
    check('수동 성분 커버: 근거 source=manual_ingredient', Boolean(m) && m.evidence[0].source === 'manual_ingredient', JSON.stringify(m ?? r4));
    check('수동 성분 미매칭은 실패 목록에 넣지 않음', r4.unmappedMaterials.length === 0 && !findMatch(r4, '루테인'), JSON.stringify(r4.unmappedMaterials));
  }

  console.log('\n5) 성분 갭 조립(buildGapView)');
  {
    const interests = [
      { ingredientId: 'ing-vitd', name: '비타민D' },
      { ingredientId: 'ing-lutein', name: '루테인' },
    ];
    const inputs = [
      { productName: 'P1', rawMaterialText: '콜레칼시페롤' },
    ];
    const gap = svc.buildGapView(inputs, MASTER, interests);
    check('커버된 관심 성분: covered=true + 근거', gap.interests[0].covered === true && gap.interests[0].evidence.length === 1, JSON.stringify(gap.interests[0]));
    check('미커버 성분: gap 목록으로 반환', gap.gap.length === 1 && gap.gap[0].name === '루테인', JSON.stringify(gap.gap));
    check('gap 성분은 interests에 covered=false', gap.interests[1].covered === false && gap.interests[1].evidence.length === 0);

    const gap2 = svc.buildGapView([
      { productName: null, rawMaterialText: '비타민D', source: 'manual_ingredient' },
    ], MASTER, interests);
    check('수동 성분으로도 커버 판정', gap2.interests[0].covered === true && gap2.interests[0].evidence[0].source === 'manual_ingredient', JSON.stringify(gap2.interests[0]));
  }

  console.log(`\n== 결과: ${passed} 통과 / ${failed} 실패 ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('테스트 실행 실패:', e);
  process.exit(1);
});