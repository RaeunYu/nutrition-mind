/**
 * 도구 라우터 (Epic #3 · T4 #36, ADR-0003 결정 4·5).
 *
 * 질문 텍스트를 도구 카테고리(배송 / 주문·결제 / 고객·성분 / 법령·기능성)로 라우팅한다.
 * 두 기법을 **같은 인터페이스**로 제공해 런타임에 교체할 수 있다(Q5(c) 확정):
 *
 *  - `embedding`: 질문과 카테고리 설명을 qwen3-embedding:0.6b로 임베딩해 코사인 유사도 top-k.
 *                 **LLM 호출이 없다** — 하네스가 언어 이해 없이도 의미 기반으로 카테고리를 고르는 방법.
 *  - `llm`:       카테고리만 뱉는 짧은 LLM 호출. 복합 의도면 최대 2개를 고른다.
 *
 * 안전장치(Q13 확정): 임베딩 top-1 점수가 임계값 미달이면 **상위 2개 카테고리를 병합**해
 * recall을 우선한다(배송 질문이 지식 카테고리로 새는 것을 방지).
 *
 * 카테고리 목록은 MCP 카탈로그(T3)에서 가져온다 — 도구가 늘면 라우팅 대상도 자동으로 늘어난다.
 * 카테고리 설명은 라우팅 품질을 좌우하므로 아래 상수에 한국어 예시 어휘를 함께 둔다.
 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from './llm.service';
import { McpToolCatalogService, CATEGORY_ORDER } from './mcp-tool-catalog.service';

export type RouterMethod = 'embedding' | 'llm';

export interface RoutingCandidate {
  category: string;
  score: number;
}

export interface RoutingDecision {
  method: RouterMethod;
  candidates: RoutingCandidate[];
  /** 최종 선택 카테고리 — 1개, 또는 임계값 미달·복합 의도일 때 2개. */
  picked: string[];
  /** 임베딩 top-1이 임계값 미달이어서 top-2를 병합했는지. */
  belowThreshold: boolean;
  threshold: number;
  latencyMs: number;
  /** LLM 분류 실패로 임베딩으로 폴백했는지(폴백 시 method는 embedding). */
  fallbackFrom?: RouterMethod;
}

export interface RouteOptions {
  method?: RouterMethod;
  threshold?: number;
}

/** 임베딩 라우팅 기본 임계값 — 골드셋(test:tool-routing)으로 튜닝한 값. */
export const DEFAULT_ROUTER_THRESHOLD = 0.36;

/**
 * 카테고리 설명 — 라우팅 입력. 예시 어휘를 포함해 의미 매칭을 돕는다.
 * 주의: 도메인 전역어(예: "건강기능식품")를 여러 카테고리에 넣으면 그 카테고리가 질의를 흡수한다.
 * 실제로 고객·성분 설명에 "건강기능식품"이 있을 때 법령 질의가 전부 고객·성분으로 오분류됐다
 * (골드셋 68.8% → 설명 정리 후 81.3%). 어휘는 카테고리를 구분하는 말로만 채운다.
 */
export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  배송: '배송 조회, 배송 상태, 배송 중, 배송 지연, 배송 완료, 언제 도착, 발송, 출고, 운송장, 송장, 택배, 집화, 물건이 안 와요, 배송 이력, 배송지',
  '주문·결제':
    '주문 내역, 주문 목록, 주문 상세, 주문번호, 주문 취소, 고객이 주문한 제품, 구매 내역, 결제 상태, 결제 실패, 결제 수단, 카드 결제, 환불, 결제 완료, 미출고',
  '고객·성분': '고객 프로필, 고객 이름, 고객 정보, 고객 검색, 섭취 제품, 먹고 있는 영양제, 관심 성분, 성분 갭, 부족한 성분, 성분 커버리지, 복용 중인 제품',
  '법령·기능성':
    '법령, 법률, 조문, 시행령, 시행규칙, 표시기준, 행정규칙, 고시, 광고 문구, 표시 광고, 영업 허가 절차, 기능성 원료, 기능성 문구, 품목제조신고, 고시기능성, 질병 예방 표현, 인정 내용, 건강기능식품 법령',
};

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

@Injectable()
export class ToolRouterService {
  private readonly logger = new Logger(ToolRouterService.name);
  /** 카테고리 설명 임베딩 캐시(설명은 정적이므로 1회만 계산). */
  private readonly categoryEmbeddings = new Map<string, number[]>();

  constructor(
    private readonly catalog: McpToolCatalogService,
    private readonly llm: LlmService,
  ) {}

  private get ollamaBase(): string {
    return (process.env.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434').replace(/\/+$/, '');
  }

  private get embeddingModel(): string {
    return process.env.EMBEDDING_MODEL ?? 'qwen3-embedding:0.6b';
  }

  /** 카테고리 목록 — MCP 카탈로그 기준(알 수 없으면 CATEGORY_ORDER). */
  async categories(): Promise<string[]> {
    try {
      const summaries = await this.catalog.listCategories();
      if (summaries.length > 0) return summaries.map((s) => s.category);
    } catch (e: any) {
      this.logger.warn(`카테고리 조회 실패 — 기본 순서 사용: ${e?.message ?? e}`);
    }
    return [...CATEGORY_ORDER];
  }

  private async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.ollamaBase}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.embeddingModel, input: text }),
    });
    if (!res.ok) throw new Error(`임베딩 HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const data = (await res.json()) as { embeddings: number[][] };
    const vec = data.embeddings?.[0];
    if (!Array.isArray(vec)) throw new Error('임베딩 응답 형식이 올바르지 않습니다.');
    return vec;
  }

  private async categoryVector(category: string): Promise<number[]> {
    const cached = this.categoryEmbeddings.get(category);
    if (cached) return cached;
    const description = CATEGORY_DESCRIPTIONS[category] ?? category;
    const vec = await this.embed(`${category}. ${description}`);
    this.categoryEmbeddings.set(category, vec);
    return vec;
  }

  /** 라우팅 — method 미지정 시 임베딩(런타임 기본, Q6 확정). */
  async route(question: string, options: RouteOptions = {}): Promise<RoutingDecision> {
    const method = options.method ?? 'embedding';
    if (method === 'llm') return this.routeByLlm(question);
    return this.routeByEmbedding(question, options.threshold);
  }

  /** 임베딩 top-k 라우팅(LLM 호출 없음). */
  async routeByEmbedding(question: string, threshold = DEFAULT_ROUTER_THRESHOLD): Promise<RoutingDecision> {
    const started = Date.now();
    const categories = await this.categories();
    const [qVec, catVecs] = await Promise.all([
      this.embed(question),
      Promise.all(categories.map((c) => this.categoryVector(c))),
    ]);
    const candidates: RoutingCandidate[] = categories
      .map((category, i) => ({ category, score: Number(cosine(qVec, catVecs[i]).toFixed(4)) }))
      .sort((a, b) => b.score - a.score);

    const belowThreshold = candidates.length === 0 || candidates[0].score < threshold;
    const picked = belowThreshold
      ? candidates.slice(0, 2).map((c) => c.category) // Q13: 임계값 미달 → top-2 병합(recall 우선)
      : [candidates[0].category];

    return { method: 'embedding', candidates, picked, belowThreshold, threshold, latencyMs: Date.now() - started };
  }

  /** LLM 분류 라우팅 — 실패하면 임베딩으로 폴백한다(가용성 우선). */
  async routeByLlm(question: string): Promise<RoutingDecision> {
    const started = Date.now();
    const categories = await this.categories();
    const system =
      '당신은 고객 상담 질의를 도구 카테고리로 분류하는 라우터입니다. ' +
      '반드시 아래 JSON만 출력하세요(다른 텍스트 금지): {"categories":["카테고리"],"reason":"한국어 사유"}. ' +
      '복합 의도면 최대 2개까지 고르세요.';
    const user =
      `가능한 카테고리: ${categories.join(', ')}\n` +
      `질문: ${question}\n` +
      '가장 관련 있는 카테고리만 고르세요. 관련 카테고리가 없으면 빈 배열을 출력하세요.';

    const res = await this.llm.complete(system, user);
    if (!res.ok || !res.text) {
      this.logger.warn(`LLM 라우팅 실패 — 임베딩으로 폴백: ${res.reason ?? '응답 없음'}`);
      const fallback = await this.routeByEmbedding(question);
      return { ...fallback, fallbackFrom: 'llm', belowThreshold: true };
    }

    const parsed = this.parseCategories(res.text, categories);
    if (parsed.length === 0) {
      const fallback = await this.routeByEmbedding(question);
      return { ...fallback, fallbackFrom: 'llm', belowThreshold: true };
    }
    const picked = parsed.slice(0, 2);
    const candidates: RoutingCandidate[] = picked.map((category, i) => ({ category, score: i === 0 ? 1 : 0.9 }));
    return {
      method: 'llm',
      candidates,
      picked,
      belowThreshold: picked.length > 1, // 복합 의도로 2개를 고른 경우(병합 제공)
      threshold: DEFAULT_ROUTER_THRESHOLD,
      latencyMs: Date.now() - started,
    };
  }

  /** LLM 응답에서 카테고리 추출 — 허용 목록에 없는 값은 버린다. */
  private parseCategories(text: string, allowed: string[]): string[] {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return [];
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as { categories?: unknown };
      const raw = Array.isArray(obj.categories) ? obj.categories : [];
      const picked: string[] = [];
      for (const value of raw) {
        const name = String(value).trim();
        if (allowed.includes(name) && !picked.includes(name)) picked.push(name);
      }
      return picked;
    } catch {
      return [];
    }
  }
}
