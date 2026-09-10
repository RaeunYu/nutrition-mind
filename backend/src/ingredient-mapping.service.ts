/**
 * 성분 매핑 서비스 (이슈 #16) — 원료명 텍스트 → 표준 성분 키워드 규칙 매핑.
 *
 * 용어(CONTEXT.md): 성분(표준화된 성분명, 예: 비타민D) ≠ 원료(식약처 원재료명 텍스트) — 혼용 금지.
 *
 * 설계:
 *  - 규칙 소스는 성분 마스터(ingredients: name·synonyms·keywords, 쉼표 구분)이다.
 *    매칭 키워드 = 성분명 + 동의어 + 키워드(정규화 후 중복 제거).
 *  - 정규화: 소문자화 + 공백·하이픈 제거("비타민 D-3"≡"비타민D3", "오메가-3"≡"오메가3").
 *  - 매칭은 정규화 부분일치(includes) 기준 — 표기 변형(함유·추출물 등 접미어)에 강건.
 *  - 결과는 성분별 매칭(근거: 어느 키워드가 어느 원료 텍스트에서 매칭됐는지)과
 *    매핑 실패 원료 목록(매칭 전무한 섭취 제품 텍스트)을 함께 반환한다.
 *  - 수동 성분(customer_ingredients 성분명)도 커버 근거로 포함하되 source 라벨로 구분한다.
 *    수동 성분은 성분명이지 원료가 아니므로 매핑 실패 목록에는 넣지 않는다.
 *
 * 이 파일의 함수는 DB·프레임워크 의존 없는 순수 함수다(단위 테스트: test/ingredient-mapping.test.mjs).
 */
import { Injectable } from '@nestjs/common';

/** 성분 마스터 규칙 — ingredients 테이블 행(name/synonyms/keywords는 쉼표 구분 텍스트). */
export interface IngredientRule {
  id: string;
  name: string;
  synonyms?: string | null;
  keywords?: string | null;
}

/** 매핑 근거 — 어느 키워드가 어느 원료 텍스트에서 매칭됐는지. */
export interface MappingEvidence {
  /** 원료 텍스트가 나온 제품명(수동 성분이면 null). */
  productName: string | null;
  /** 매칭된 키워드(마스터 원문 표기 보존). */
  matchedKeyword: string;
  /** 매칭 대상 원료명 텍스트(원문). */
  rawMaterialText: string;
  /** 커버 근거 구분: 섭취 제품 원료 텍스트 / 수동 성분. */
  source: 'intake_product' | 'manual_ingredient';
}

/** 성분별 매칭 결과(근거 포함, 여러 제품에서 매칭되면 근거 여러 건). */
export interface IngredientMatch {
  ingredientId: string;
  ingredientName: string;
  evidence: MappingEvidence[];
}

/** 매핑 실패 원료(섭취 제품 텍스트 단위 — 어떤 성분 키워드도 매칭되지 않은 원료 텍스트). */
export interface UnmappedMaterial {
  productName: string | null;
  rawMaterialText: string;
}

export interface MappingResult {
  matches: IngredientMatch[];
  unmappedMaterials: UnmappedMaterial[];
}

/** 매핑 입력 — 섭취 제품의 원료 텍스트 또는 수동 성분명. */
export interface MaterialInput {
  productName: string | null;
  rawMaterialText: string | null;
  source?: 'intake_product' | 'manual_ingredient';
}

/** 관심 성분 참조(갭 조립 입력). */
export interface InterestRef {
  ingredientId: string;
  name: string;
}

/** 관심 성분별 커버 여부(근거 포함). */
export interface GapInterest extends InterestRef {
  covered: boolean;
  evidence: MappingEvidence[];
}

/** 미커버 성분(성분 갭). */
export interface GapIngredient {
  ingredientId: string;
  name: string;
}

export interface GapResult {
  interests: GapInterest[];
  gap: GapIngredient[];
  unmappedMaterials: UnmappedMaterial[];
}

/** 정규화 — 소문자화 + 공백·하이픈 제거(표기 변형 무시용 최소 정규화). */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '').replace(/-/g, '');
}

/** 규칙의 매칭 키워드(정규화 문자열 배열 — 성분명+동의어+키워드, 중복 제거). */
export function ruleKeywords(rule: IngredientRule): string[] {
  return compileRule(rule).map((k) => k.normalized);
}

/** 규칙 컴파일 — 매칭용 정규형과 근거 표시용 원문을 쌍으로 보관. */
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
  return out;
}

/**
 * 원료 텍스트 목록 → 성분 매칭.
 * - 한 텍스트에서 여러 성분이 매칭될 수 있고, 같은 성분이 여러 제품에서 매칭되면 근거가 통합된다.
 * - 매칭 순서는 규칙(마스터) 순서를 따른다.
 * - 섭취 제품(source 기본값 intake_product)에서 매칭이 전무하면 매핑 실패 목록에 들어간다.
 *   수동 성분(manual_ingredient)은 실패 목록 대상이 아니다.
 */
export function mapMaterials(
  inputs: MaterialInput[],
  rules: IngredientRule[],
): MappingResult {
  const compiled = rules.map((r) => ({ id: r.id, name: r.name, keywords: compileRule(r) }));
  const matchesById = new Map<string, IngredientMatch>();
  const unmappedMaterials: UnmappedMaterial[] = [];

  for (const input of inputs) {
    const text = (input.rawMaterialText ?? '').trim();
    if (text.length === 0) continue;
    const source = input.source ?? 'intake_product';
    const normalized = normalizeText(text);
    let hits = 0;
    for (const rule of compiled) {
      const hit = rule.keywords.find((k) => normalized.includes(k.normalized));
      if (!hit) continue;
      hits++;
      const match = matchesById.get(rule.id) ?? {
        ingredientId: rule.id,
        ingredientName: rule.name,
        evidence: [],
      };
      match.evidence.push({
        productName: input.productName,
        matchedKeyword: hit.original,
        rawMaterialText: text,
        source,
      });
      matchesById.set(rule.id, match);
    }
    if (source === 'intake_product' && hits === 0) {
      unmappedMaterials.push({ productName: input.productName, rawMaterialText: text });
    }
  }

  const matches = compiled
    .filter((c) => matchesById.has(c.id))
    .map((c) => matchesById.get(c.id)!);
  return { matches, unmappedMaterials };
}

/**
 * 성분 갭 조립 — 관심 성분별 커버 여부 + 미커버 성분 목록 + 매핑 실패 원료 목록.
 * covered 판정 원천: 섭취 제품 원료 텍스트 매핑 + 수동 성분(customer_ingredients) 매칭.
 */
export function buildGapView(
  inputs: MaterialInput[],
  rules: IngredientRule[],
  interests: InterestRef[],
): GapResult {
  const mapping = mapMaterials(inputs, rules);
  const coveredById = new Map(mapping.matches.map((m) => [m.ingredientId, m] as const));
  const interestsView: GapInterest[] = interests.map((i) => {
    const match = coveredById.get(i.ingredientId);
    return match
      ? { ingredientId: i.ingredientId, name: i.name, covered: true, evidence: match.evidence }
      : { ingredientId: i.ingredientId, name: i.name, covered: false, evidence: [] };
  });
  const gap = interestsView
    .filter((i) => !i.covered)
    .map((i) => ({ ingredientId: i.ingredientId, name: i.name }));
  return { interests: interestsView, gap, unmappedMaterials: mapping.unmappedMaterials };
}

/** Nest DI용 래퍼 — 로직은 위 순수 함수에 위임한다. */
@Injectable()
export class IngredientMappingService {
  normalizeText(text: string): string {
    return normalizeText(text);
  }

  ruleKeywords(rule: IngredientRule): string[] {
    return ruleKeywords(rule);
  }

  mapMaterials(inputs: MaterialInput[], rules: IngredientRule[]): MappingResult {
    return mapMaterials(inputs, rules);
  }

  buildGapView(inputs: MaterialInput[], rules: IngredientRule[], interests: InterestRef[]): GapResult {
    return buildGapView(inputs, rules, interests);
  }
}