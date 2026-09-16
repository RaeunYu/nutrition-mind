/**
 * 에이전트 하네스 (Epic #3 · T5 #37, ADR-0003).
 *
 * 배경 문서 2.1의 루프를 구현한다:
 *   ① 도구 스키마를 LLM에 주입 → ② LLM이 tool_calls(의도) 반환 → ③ 하네스가 MCP로 실행
 *   → ④ 결과를 컨텍스트에 넣어 재호출 → ⑤ 최종 자연어 답변.
 *
 * **중요**: LLM은 백엔드 함수를 직접 실행하지 못한다. 실제 실행은 100% 이 하네스(=백엔드 코드)의 몫이다.
 *
 * 주입 모드(A/B, Q6 확정 — 같은 카탈로그·실행기를 공유):
 *  - `prefill`(기본): 라우터가 카테고리를 먼저 고르고, 그 카테고리 도구만 LLM에 선언한다.
 *  - `discover`(학습): 첫 호출에는 메타 도구 `list_tools`만 선언한다. LLM이 카테고리를 골라
 *    `list_tools(category)`를 호출하면 하네스가 그 카테고리 도구 스키마를 반환하고,
 *    **다음 LLM 호출에 그 도구들을 다시 선언**한다(re-declare).
 *    함수 호출 프로토콜상 선언되지 않은 도구는 호출할 수 없으므로 이 재선언이 필수다.
 *
 * 안전장치(Q13 확정): 최대 반복 3회, 도구 오류·타임아웃은 `{error}` tool_result로 모델에 반환,
 * 도구 호출 없는 응답이면 즉시 종료. 실패 시 answer=null + reason을 반환하고 컨트롤러가 폴백한다.
 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService, HarnessMessage, LlmToolSpec } from './llm.service';
import { McpToolCatalogService, ToolActor, ToolDescriptor, CATEGORY_ORDER } from './mcp-tool-catalog.service';
import { ToolRouterService, RoutingDecision, RouterMethod } from './tool-router.service';

export type InjectionMode = 'prefill' | 'discover';

export interface HarnessTraceStep {
  step: number;
  type: 'router' | 'llm_call' | 'tool_call' | 'tool_result' | 'final' | 'notice';
  [key: string]: unknown;
}

export interface HarnessRunInput {
  question: string;
  /** 고객 컨텍스트 블록(상담 맥락 참고용) — 근거는 도구 결과여야 한다. */
  customerContext?: string;
  mode?: InjectionMode;
  router?: RouterMethod;
  actor?: ToolActor;
}

export interface HarnessRunResult {
  /** 최종 자연어 답변. null이면 하네스가 답변하지 못한 것 — 컨트롤러가 폴백한다. */
  answer: string | null;
  reason?: string;
  routing: RoutingDecision | null;
  trace: HarnessTraceStep[];
  iterations: number;
  usedToolCalls: string[];
  notices: string[];
  /** 법령 도구가 반환한 근거 통계(응답의 sources·top1 유지용). */
  legal: { count: number; top1: number } | null;
}

export const MAX_HARNESS_ITERATIONS = 3;
export const LIST_TOOLS_NAME = 'list_tools';

/** 동적 발견용 메타 도구 — MCP 도구가 아니라 **하네스가 실행**하는 도구다. */
export function listToolsSpec(categories: string[]): LlmToolSpec {
  return {
    name: LIST_TOOLS_NAME,
    description:
      '도구 카테고리에 속한 도구 목록(이름·설명·입력 스키마)을 반환합니다. ' +
      '질문에 맞는 도구를 고르기 전에 이 도구로 목록을 확인하세요.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: categories, description: '조회할 도구 카테고리' },
      },
      required: ['category'],
    },
  };
}

function toSpec(tool: ToolDescriptor): LlmToolSpec {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

/** trace에 남길 도구 결과 요약(과도한 본문은 자른다). */
function summarizeToolResult(ok: boolean, payload: unknown, error?: string): string {
  if (!ok) return String(error ?? '도구 실행 실패').slice(0, 160);
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

@Injectable()
export class AgentHarnessService {
  private readonly logger = new Logger(AgentHarnessService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly catalog: McpToolCatalogService,
    private readonly router: ToolRouterService,
  ) {}

  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const started = Date.now();
    const trace: HarnessTraceStep[] = [];
    const notices: string[] = [];
    const push = (type: HarnessTraceStep['type'], data: Record<string, unknown>) => {
      trace.push({ step: trace.length + 1, type, ...data });
    };

    const mode: InjectionMode = input.mode ?? 'prefill';
    const method: RouterMethod = input.router ?? 'embedding';

    // 1) 라우팅 — 실패하면 도구 없이 진행할 수 없으므로 폴백 사유를 반환한다.
    let routing: RoutingDecision | null = null;
    let offered: ToolDescriptor[] = [];
    try {
      routing = await this.router.route(input.question, { method });
      push('router', {
        method: routing.method,
        candidates: routing.candidates,
        picked: routing.picked,
        belowThreshold: routing.belowThreshold,
        fallbackFrom: routing.fallbackFrom,
        latencyMs: routing.latencyMs,
      });
      if (mode === 'prefill') offered = await this.catalog.listByCategories(routing.picked);
    } catch (e: any) {
      const reason = `도구 라우팅 실패: ${e?.message ?? e}`;
      push('notice', { message: reason });
      return { answer: null, reason, routing: null, trace, iterations: 0, usedToolCalls: [], notices, legal: null };
    }

    const categories = await this.router.categories().catch(() => [...CATEGORY_ORDER]);
    // discover 모드에서 발견한 도구를 **누적**한다 — list_tools를 여러 번 불러도 이전 도구를 잃지 않는다.
    const discovered = new Map<string, ToolDescriptor>();
    let llmTools: LlmToolSpec[] = mode === 'discover' ? [listToolsSpec(categories)] : offered.map(toSpec);

    const messages: HarnessMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
      { role: 'user', content: this.buildUserPrompt(input, mode, categories) },
    ];

    const usedToolCalls: string[] = [];
    let usefulToolResults = 0;
    let legal: { count: number; top1: number } | null = null;
    let answer: string | null = null;
    let reason: string | undefined;
    let iterations = 0;

    for (let i = 1; i <= MAX_HARNESS_ITERATIONS; i++) {
      iterations = i;
      push('llm_call', { iteration: i, mode, toolsOffered: llmTools.map((t) => t.name) });

      const turnRes = await this.llm.chatWithTools(messages, llmTools);
      if (!turnRes.ok || !turnRes.turn) {
        reason = turnRes.reason ?? 'LLM 호출 실패';
        push('notice', { message: reason });
        break;
      }
      const turn = turnRes.turn;

      // 도구 호출이 없으면 그 텍스트가 최종 답변이다(즉시 종료).
      if (turn.toolCalls.length === 0) {
        answer = turn.content.trim() || null;
        if (!answer) reason = 'LLM이 빈 답변을 반환했습니다.';
        break;
      }

      messages.push({ role: 'assistant', content: turn.content, toolCalls: turn.toolCalls });

      for (const call of turn.toolCalls) {
        push('tool_call', { iteration: i, tool: call.name, args: call.arguments });
        usedToolCalls.push(call.name);

        if (call.name === LIST_TOOLS_NAME) {
          // 동적 발견 — 하네스가 도구 목록을 돌려주고, 다음 호출에 그 도구들을 재선언한다.
          const category = String(call.arguments?.category ?? '');
          let tools: ToolDescriptor[] = [];
          try {
            tools = category ? await this.catalog.listByCategory(category) : await this.catalog.listTools();
          } catch (e: any) {
            tools = [];
            notices.push(`도구 목록 조회 실패: ${e?.message ?? e}`);
          }
          for (const t of tools) discovered.set(t.name, t);
          llmTools = [...discovered.values()].map(toSpec);
          const payload = {
            category,
            availableCategories: categories,
            tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          };
          push('tool_result', {
            tool: call.name,
            ok: tools.length > 0,
            summary: `카테고리 '${category}' 도구 ${tools.length}개 반환(다음 호출에 재선언)`,
            latencyMs: 0,
          });
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(payload) });
          continue;
        }

        // 프로토콜 정합: 선언되지 않은 도구는 실행하지 않는다(모델이 목록을 다시 확인하도록 안내).
        if (!llmTools.some((t) => t.name === call.name)) {
          const available = llmTools.map((t) => t.name);
          push('tool_result', {
            tool: call.name,
            ok: false,
            summary: `선언되지 않은 도구 — 사용 가능: ${available.join(', ') || '없음'}`,
            latencyMs: 0,
          });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify({
              error: `도구 ${call.name}은(는) 현재 제공되지 않았습니다. 사용 가능한 도구: ${available.join(', ') || '없음'}`,
            }),
          });
          continue;
        }

        const outcome = await this.catalog.callTool(call.name, call.arguments as Record<string, unknown>, input.actor);
        const resultPayload: unknown = outcome.ok ? outcome.result : null;
        const errorText: string | undefined = outcome.ok ? undefined : outcome.error;
        if (outcome.ok) usefulToolResults += 1;
        if (call.name === 'search_legal_provisions' && outcome.ok) {
          const payload = resultPayload as { results?: Array<{ score?: number }> } | null;
          const results = Array.isArray(payload?.results) ? payload!.results! : [];
          legal = { count: results.length, top1: results.reduce((max, r) => Math.max(max, Number(r?.score ?? 0)), 0) };
        }
        push('tool_result', {
          tool: call.name,
          ok: outcome.ok,
          category: outcome.category,
          summary: summarizeToolResult(outcome.ok, resultPayload, errorText),
          latencyMs: outcome.latencyMs,
        });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(outcome.ok ? resultPayload : { error: errorText }),
        });
      }

      if (i === MAX_HARNESS_ITERATIONS) {
        reason = `최대 반복(${MAX_HARNESS_ITERATIONS}회)에 도달해 최종 답변을 만들지 못했습니다.`;
        push('notice', { message: reason });
      }
    }

    // 안전장치: 도구 호출 한도를 다 썼는데 답변이 없으면, **도구 없이 1회 강제 합성**한다.
    // (도구 호출 반복은 3회로 고정하되, 모은 결과로는 반드시 답을 만들게 한다 — B 모드에서 특히 필요.)
    let synthesizedAfterLimit = false;
    if (!answer && usefulToolResults > 0) {
      messages.push({
        role: 'user',
        content: '도구 호출은 여기까지입니다. 지금까지의 도구 결과만으로 질문에 답하세요. 근거가 부족하면 부족하다고 말하세요.',
      });
      const finalTurn = await this.llm.chatWithTools(messages, []);
      if (finalTurn.ok && finalTurn.turn?.content?.trim()) {
        answer = finalTurn.turn.content.trim();
        synthesizedAfterLimit = true;
        reason = undefined; // 답변을 얻었으므로 폴백 사유를 지운다
        push('notice', { message: `도구 호출 한도(${MAX_HARNESS_ITERATIONS}회)에 도달해 수집된 결과로 답변을 생성했습니다.` });
        notices.push(`ℹ️ 도구 호출 한도(${MAX_HARNESS_ITERATIONS}회)에 도달해 수집된 결과로 답변을 생성했습니다.`);
      }
    }

    push('final', { iterations, usedToolCalls, answered: Boolean(answer), synthesizedAfterLimit, totalLatencyMs: Date.now() - started });
    if (reason) notices.push(reason);
    return { answer, reason, routing, trace, iterations, usedToolCalls, notices, legal };
  }

  private buildSystemPrompt(): string {
    return (
      '당신은 건강기능식품 기업의 영업·상담 담당자를 돕는 상담 보조 어시스턴트입니다.\n' +
      '주문·결제·배송·고객·성분에 관한 질문은 반드시 제공된 도구로 실제 데이터를 조회한 뒤 답하세요. 추측하거나 지어내지 마세요.\n' +
      '법령·기능성 근거가 필요하면 search_legal_provisions 도구를 사용하세요.\n' +
      '고객 ID(UUID)가 주어졌으면 그 값을 customer_id로 그대로 사용하세요. 주문번호를 모를 때는 고객 기준 목록 도구를 먼저 사용하세요.\n' +
      '인자가 질문이나 고객 정보에 있으면 추측하지 말고 그 값을 사용하세요.\n' +
      '도구 결과에 없는 내용은 "확인되지 않습니다"라고 답하세요.\n' +
      '한국어로 간결하게 답하세요.'
    );
  }

  private buildUserPrompt(input: HarnessRunInput, mode: InjectionMode, categories: string[]): string {
    const lines = [`질문: ${input.question}`];
    if (input.customerContext) {
      lines.push('', '[상담 중인 고객 정보]', input.customerContext, '(고객 정보는 상담 맥락 참고용 — 답변 근거는 도구 조회 결과여야 한다.)');
    }
    if (mode === 'discover') {
      lines.push('', `도구를 사용하려면 먼저 ${LIST_TOOLS_NAME} 도구로 카테고리(${categories.join(', ')})의 도구 목록을 확인하세요.`);
    }
    return lines.join('\n');
  }
}
