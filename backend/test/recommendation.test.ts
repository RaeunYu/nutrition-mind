/**
 * 추천 제안 생성 로직 단위 테스트 (이슈 #17) — 순수 함수 buildProposals 검증.
 * 실행: npm run test:recommendation (tsx test/recommendation.test.mjs)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProposals } from '../src/recommendation.service';

const RULES = [
  { id: 'ing-d', name: '비타민D', synonyms: '비타민D3,콜레칼시페롤', keywords: null },
  { id: 'ing-p', name: '프로바이오틱스', synonyms: null, keywords: '유산균,비피두스' },
];

const CANDIDATES: FoodSafetyCandidate[] = [
  { apiCode: 'C003', reportNo: '111', productName: '유산균 종합', rawMaterials: '유산균배양건조물, 정제수' },
  { apiCode: 'C003', reportNo: '222', productName: '비타민D 드롭스', rawMaterials: '비타민D3 100IU' },
  { apiCode: 'C003', reportNo: '333', productName: '종합비타민', rawMaterials: '비타민D3, 비타민C, 아연' },
  { apiCode: 'C003', reportNo: '444', productName: '프로바이오틱스 캡슐', rawMaterials: '비피두스 혼합분말' },
  { apiCode: 'I0030', reportNo: '555', productName: '연골 건강식', rawMaterials: '콘드로이틴, MSM' },
  { apiCode: 'C003', reportNo: '666', productName: '수면 보조', rawMaterials: '멜라토닌 1mg' },
];

test('갭 성분 키워드로 후보 매칭 + 근거 생성', () => {
  const result = buildProposals(
    [{ ingredientId: 'ing-d', name: '비타민D' }],
    RULES,
    CANDIDATES,
    new Set(),
  );
  assert.equal(result.proposals.length, 2); // 222 + 333 (동일 성분 매칭, 333도 비타민D 포함)
  assert.ok(result.proposals.every((p) => p.ingredientName === '비타민D'));
  assert.ok(result.proposals.some((p) => p.evidenceKeyword === '비타민D3' && p.productName === '비타민D 드롭스'));
});

test('동의어 키워드로 다른 원료 텍스트 매칭', () => {
  const result = buildProposals(
    [{ ingredientId: 'ing-p', name: '프로바이오틱스' }],
    RULES,
    CANDIDATES,
    new Set(),
  );
  assert.equal(result.proposals.length, 2); // 유산균 종합(유산균) + 프로바이오틱스 캡슐(비피두스)
  assert.ok(result.proposals.every((p) => p.ingredientName === '프로바이오틱스'));
  assert.ok(result.proposals.some((p) => p.evidenceKeyword === '비피두스'));
});

test('섭취 중 제품은 제외한다', () => {
  const linked = new Set(['C003#222']); // 비타민D 드롭스는 이미 섭취 중
  const result = buildProposals(
    [{ ingredientId: 'ing-d', name: '비타민D' }],
    RULES,
    CANDIDATES,
    linked,
  );
  assert.ok(result.proposals.every((p) => p.reportNo !== '222'));
  assert.equal(result.proposals.length, 1); // 333만 남음
});

test('성분당 후보는 maxPerIngredient로 제한', () => {
  const candidates = CANDIDATES.concat(
    Array.from({ length: 5 }, (_, i) => ({
      apiCode: 'C003', reportNo: `70${i}`, productName: `비타민D ${i}호`, rawMaterials: '비타민D3 50IU',
    })),
  );
  const result = buildProposals(
    [{ ingredientId: 'ing-d', name: '비타민D' }],
    RULES,
    candidates,
    new Set(),
    { maxPerIngredient: 3 },
  );
  assert.equal(result.proposals.length, 3);
});

test('전체 제안은 maxTotal로 제한', () => {
  const manyGap = [
    { ingredientId: 'ing-d', name: '비타민D' },
    { ingredientId: 'ing-p', name: '프로바이오틱스' },
  ];
  const result = buildProposals(manyGap, RULES, CANDIDATES, new Set(), { maxTotal: 3 });
  assert.ok(result.proposals.length <= 3);
});

test('같은 제품은 여러 갭 성분에 중복 제안되지 않는다', () => {
  const rules = [
    ...RULES,
    { id: 'ing-c', name: '비타민C', synonyms: '아스코르브산', keywords: '비타민C' },
  ];
  const result = buildProposals(
    [{ ingredientId: 'ing-d', name: '비타민D' }, { ingredientId: 'ing-c', name: '비타민C' }],
    rules,
    [CANDIDATES[2]], // 종합비타민: 비타민D·비타민C 둘 다 포함
    new Set(),
  );
  assert.equal(result.proposals.length, 1); // 333은 한 번만 제안
});

test('후보를 찾지 못한 갭 성분은 noCandidateIngredients로 보고', () => {
  const result = buildProposals(
    [{ ingredientId: 'ing-p', name: '프로바이오틱스' }],
    RULES,
    [CANDIDATES[5]], // 멜라토닌만 — 유산균·비피두스 매칭 없음
    new Set(),
  );
  assert.equal(result.proposals.length, 0);
  assert.deepEqual(result.noCandidateIngredients, [{ ingredientId: 'ing-p', name: '프로바이오틱스' }]);
});

test('원료 텍스트가 비어 있는 후보는 제외', () => {
  const result = buildProposals(
    [{ ingredientId: 'ing-d', name: '비타민D' }],
    RULES,
    [{ apiCode: 'C003', reportNo: '888', productName: '빈 원료 제품', rawMaterials: null }],
    new Set(),
  );
  assert.equal(result.proposals.length, 0);
  assert.equal(result.noCandidateIngredients.length, 1);
});

test('근거에 원문 표기 보존(정규화 전 키워드)', () => {
  const result = buildProposals(
    [{ ingredientId: 'ing-d', name: '비타민D' }],
    RULES,
    [CANDIDATES[1]], // '비타민D3 100IU'
  );
  assert.equal(result.proposals[0].evidenceKeyword, '비타민D3');
  assert.ok(result.proposals[0].evidenceRawMaterial.includes('100IU'));
});

test('갭 성분 규칙이 마스터에 없으면 무시', () => {
  const result = buildProposals(
    [{ ingredientId: 'ing-x', name: '미등록성분' }],
    RULES,
    CANDIDATES,
    new Set(),
  );
  assert.equal(result.proposals.length, 0);
});