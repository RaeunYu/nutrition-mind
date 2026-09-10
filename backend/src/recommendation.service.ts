/**
 * 성분 갭 기반 추천 제품 제안 서비스 (이슈 #17, ADR-0002 설명 가능성).
 *
 * 알고리즘(순수 함수, DB 의존 없음):
 *  1. 갭 성분(관심 성분 중 미커버)을 순서대로 처리한다.
 *  2. 각 갭 성분의 규칙 키워드(정규화)로 후보 제품(품목제조신고, 원료명 ILIKE)을 필터링한다.
 *  3. 이미 섭취 중인 제품(customer_products에 연결된 api_code+report_no)은 제외한다.
 *  4. 근거 = {갭 성분, 매칭 키워드, 원료명 텍스트} — 제품이 "어느 성분을 어떤 원료로 커버"하는지 보존.
 *  5. 랭킹: 성분당 후보 최대 3건, 전체 최대 maxTotal건. 중복(api_code+report_no)은 한 번만 제안.
 *
 * 상태 전이: proposed(생성 직후) → accepted|held(담당자 확인 — 자동 수용 없음, 이슈 지시).
 * 'accepted'는 섭취 제품으로 자동 등록하지 않는다(상태 기록만).
 */
import { Injectable } from '@nestjs/common';
import {
  GapIngredient,
  IngredientRule,
  normalizeText,
} from './ingredient-mapping.service';

/** 후보 제품 — foodsafety_rows 정규화 칼럼에서 온 스냅샷. */
export interface FoodSafetyCandidate {
  apiCode: string;
  reportNo: string | null;
  productName: string;
  rawMaterials: string | null;
}

/** 생성된 제안 초안(저장 전). */
export interface ProposalDraft {
  ingredientId: string;
  ingredientName: string;
  apiCode: string;
  reportNo: string | null;
  productName: string;
  rawMaterials: string | null;
  evidenceKeyword: string;
  evidenceRawMaterial: string;
}

export interface ProposalGenerationResult {
  proposals: ProposalDraft[];
  /** 갭 성분 중 후보를 찾지 못한 것(추천 불가 사유와 함께 보고용). */
  noCandidateIngredients: Array<{ ingredientId: string; name: string }>;
}

/** 갭 성분 → 후보 제품 매칭 + 랭킹 + 근거 부여(순수 함수). */
export function buildProposals(
  gap: GapIngredient[],
  rules: IngredientRule[],
  candidates: FoodSafetyCandidate[],
  linkedKeys: Set<string>,
  opts: { maxPerIngredient?: number; maxTotal?: number } = {},
): ProposalGenerationResult {
  const maxPerIngredient = opts.maxPerIngredient ?? 3;
  const maxTotal = opts.maxTotal ?? 10;

  const compiledById = new Map(rules.map((r) => [r.id, compileRule(r)] as const));
  const linked = linkedKeys;
  const pickedKeys = new Set(linked);
  const proposals: ProposalDraft[] = [];
  const noCandidateIngredients: Array<{ ingredientId: string; name: string }> = [];

  for (const gapItem of gap) {
    const keywords = compiledById.get(gapItem.ingredientId);
    if (!keywords || keywords.length === 0) continue; // 마스터에 없거나 키워드 없는 갭 성분은 제안 불가

    const perIngredient: ProposalDraft[] = [];
    for (const candidate of candidates) {
      if (perIngredient.length >= maxPerIngredient) break;
      const key = `${candidate.apiCode}#${candidate.reportNo ?? ''}`;
      if (pickedKeys.has(key)) continue;
      const normalizedRaw = normalizeText(candidate.rawMaterials ?? '');
      if (normalizedRaw.length === 0) continue;
      const keyword = keywords.find((k) => normalizedRaw.includes(k.normalized));
      if (!keyword) continue;
      perIngredient.push({
        ingredientId: gapItem.ingredientId,
        ingredientName: gapItem.name,
        apiCode: candidate.apiCode,
        reportNo: candidate.reportNo,
        productName: candidate.productName,
        rawMaterials: candidate.rawMaterials,
        evidenceKeyword: keyword.original,
        evidenceRawMaterial: candidate.rawMaterials ?? '',
      });
      pickedKeys.add(key); // 같은 제품이 여러 갭 성분에 중복 제안되지 않게 함
    }
    if (perIngredient.length === 0) {
      noCandidateIngredients.push({ ingredientId: gapItem.ingredientId, name: gapItem.name });
    }

    proposals.push(...perIngredient);
    if (proposals.length >= maxTotal) break;
  }
  return { proposals: proposals.slice(0, maxTotal), noCandidateIngredients };
}

/** 규칙 컴파일 — mapping.service의 내부 로직과 동일한 쌍(원문/정규화) 생성. */
function compileRule(rule: IngredientRule): Array<{ original: string; normalized: string }> {
  const out: Array<{ original: string; normalized: string }> = [];
  const seen = new Set<string>();
  for (const part of [rule.name, rule.synonyms ?? '', rule.keywords ?? '']) {
    for (const token of part.split(',')) {
      const original = token.trim();
      const normalized = original.length === 0 ? '' : normalizeText(original);
      if (normalized.length === 0 || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ original, normalized });
    }
  }
  // 더 구체적인 표기(긴 형태, 예: 비타민D3)를 먼저 매칭해 근거 품질을 높인다.
  out.sort((a, b) => b.normalized.length - a.normalized.length);
  return out;
}

/** Nest DI용 래퍼 — 로직은 위 순수 함수에 위임한다. */
@Injectable()
export class RecommendationService {
  buildProposals(
    gap: GapIngredient[],
    rules: IngredientRule[],
    candidates: FoodSafetyCandidate[],
    linkedKeys: Set<string>,
    opts?: { maxPerIngredient?: number; maxTotal?: number },
  ): ProposalGenerationResult {
    return buildProposals(gap, rules, candidates, linkedKeys, opts);
  }
}