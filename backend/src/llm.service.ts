/**
 * LLM 추상화 레이어 (Task #4 확장 — 챗봇 합성 단계).
 *
 * 지원 프로바이더 (LLM_PROVIDER):
 *   - openai    : OpenAI GPT 계열 (기본). LLM_API_KEY 필수.
 *   - anthropic : Claude. LLM_API_KEY 필수.
 *   - ollama    : 로컬 Ollama (http://127.0.0.1:11434). LLM_API_KEY 불필요.
 *
 * LLM_API_KEY가 비어있으면 비활성 → 폴백(근거 나열) 사용.
 * 호출 실패 시에도 폴백하되, 사용자에게 사유를 알림.
 */
import { Injectable, Logger } from '@nestjs/common';

export type LlmProvider = 'openai' | 'anthropic' | 'ollama';

export interface LlmResult {
  ok: boolean;
  answer?: string;
  reason?: string; // 실패/비활성 사유 (사용자에게 표시)
  provider?: LlmProvider;
  model?: string;
}

// ── 도구 호출(에이전트 하네스) 지원 — Epic #3 · T5 ─────────────────────────────
// 하네스는 프로바이더 중립 메시지/도구 표현을 쓰고, 각 프로바이더 호출에서 형식을 변환한다.

/** LLM에 주입하는 도구 스키마(MCP 도구 또는 하네스 메타 도구). */
export interface LlmToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

/** LLM이 반환한 도구 호출 의도 — 실행은 하네스(백엔드)가 한다. */
export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 한 번의 LLM 응답(텍스트 + 도구 호출 의도). */
export interface LlmTurn {
  content: string;
  toolCalls: LlmToolCall[];
}

/** 프로바이더 중립 대화 메시지. */
export type HarnessMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

/** 도구 인자 정규화 — 문자열이면 JSON 파싱, 실패 시 빈 객체. */
function normalizeToolArguments(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  private get provider(): LlmProvider {
    const p = (process.env.LLM_PROVIDER ?? 'openai').toLowerCase();
    if (p === 'anthropic' || p === 'ollama' || p === 'openai') return p;
    return 'openai';
  }

  private get model(): string {
    if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
    switch (this.provider) {
      case 'anthropic': return 'claude-sonnet-4-5';
      case 'ollama': return 'glm-5.3-flash:cloud';
      default: return 'gpt-4o-mini';
    }
  }

  /** 합성 가능 상태 진단 (비활성 시 사유 반환) */
  check(): { active: boolean; reason?: string; provider: LlmProvider; model: string } {
    const provider = this.provider;
    const key = process.env.LLM_API_KEY?.trim();
    if (provider !== 'ollama' && !key) {
      return { active: false, reason: `LLM 비활성: LLM_API_KEY 미설정 (provider=${provider})`, provider, model: this.model };
    }
    return { active: true, provider, model: this.model };
  }

  /**
   * 근거 조문 기반 응답 합성. 실패 시 ok=false + reason.
   * customerContext가 있으면(이슈 #18 상담 보조 개인화) 사용자 메시지에 고객 맥락 블록을 추가한다 —
   * 답변의 법적 근거는 여전히 근거 조문이며, 고객 정보는 상담 맥락 참고용으로만 제한한다.
   */
  async synthesize(
    question: string,
    articles: Array<{ law_name: string; article_no: string; article_title: string | null; content: string }>,
    customerContext?: string,
  ): Promise<LlmResult> {
    const status = this.check();
    if (!status.active) {
      return { ok: false, reason: status.reason, provider: status.provider, model: status.model };
    }

    const context = articles
      .map((a, i) => {
        const title = a.article_title ? ` (${a.article_title})` : '';
        return `[${i + 1}] ${a.law_name} ${a.article_no}${title}\n${a.content}`;
      })
      .join('\n\n');

    const system =
      '당신은 건강기능식품 법령·기능성 정보 어시스턴트입니다. ' +
      '반드시 제공된 근거 조문에 근거해서만 답변하고, 각 문장 뒤에 [1][2] 같은 각주 번호로 출처를 표기하세요. ' +
      '근거에 없는 내용은 추측하지 말고 "근거 조문에 근거한 설명이 없습니다"라고 말하세요. 한국어로 답변하세요.';

    const user = `질문: ${question}\n\n근거 조문:\n${context}` +
      (customerContext ? `\n\n[상담 중인 고객 정보]\n${customerContext}\n(고객 정보는 상담 맥락 참고용 — 답변 근거는 위 근거 조문이어야 한다.)` : '');

    try {
      const answer = await this.call(system, user);
      return { ok: true, answer, provider: status.provider, model: status.model };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.logger.warn(`LLM 합성 실패 (${status.provider}/${status.model}): ${msg}`);
      return { ok: false, reason: `LLM 호출 실패 (${status.provider}/${status.model}): ${msg}`, provider: status.provider, model: status.model };
    }
  }

  private async call(system: string, user: string): Promise<string> {
    const key = process.env.LLM_API_KEY?.trim();
    switch (this.provider) {
      case 'openai':
        return this.callOpenAI(key!, system, user);
      case 'anthropic':
        return this.callAnthropic(key!, system, user);
      case 'ollama':
        return this.callOllama(this.model, system, user);
    }
  }

  private async callOpenAI(key: string, system: string, user: string): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0].message.content;
  }

  private async callAnthropic(key: string, system: string, user: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { content: Array<{ text?: string }> };
    return data.content.filter((c) => c.text).map((c) => c.text).join('');
  }

  private async callOllama(model: string, system: string, user: string): Promise<string> {
    const base = process.env.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434';
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { message?: { content: string } };
    return data.message?.content ?? '';
  }

  /**
   * 범용 단일 텍스트 완성 — 도구 스키마 없이 system/user 프롬프트로 한 번 호출한다.
   * 도구 라우팅의 LLM 분류기(Epic #3 · T4) 등이 사용한다. 실패는 예외가 아니라 ok=false로 반환한다.
   */
  async complete(system: string, user: string): Promise<{ ok: boolean; text?: string; reason?: string; provider?: LlmProvider; model?: string }> {
    const status = this.check();
    if (!status.active) {
      return { ok: false, reason: status.reason, provider: status.provider, model: status.model };
    }
    try {
      const text = await this.call(system, user);
      return { ok: true, text, provider: status.provider, model: status.model };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.logger.warn(`LLM 완성 실패 (${status.provider}/${status.model}): ${msg}`);
      return { ok: false, reason: msg, provider: status.provider, model: status.model };
    }
  }

  /**
   * 도구 스키마를 주입해 LLM을 한 번 호출한다(에이전트 하네스 루프의 1스텝, Epic #3 · T5).
   * 반환된 tool_calls는 **의도**일 뿐이며 실행은 하네스가 한다. 실패는 예외가 아니라 ok=false.
   */
  async chatWithTools(
    messages: HarnessMessage[],
    tools: LlmToolSpec[],
  ): Promise<{ ok: boolean; turn?: LlmTurn; reason?: string; provider?: LlmProvider; model?: string }> {
    const status = this.check();
    if (!status.active) {
      return { ok: false, reason: status.reason, provider: status.provider, model: status.model };
    }
    try {
      const turn = await this.callWithTools(messages, tools);
      return { ok: true, turn, provider: status.provider, model: status.model };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.logger.warn(`LLM 도구 호출 실패 (${status.provider}/${status.model}): ${msg}`);
      return { ok: false, reason: `LLM 호출 실패 (${status.provider}/${status.model}): ${msg}`, provider: status.provider, model: status.model };
    }
  }

  private async callWithTools(messages: HarnessMessage[], tools: LlmToolSpec[]): Promise<LlmTurn> {
    const key = process.env.LLM_API_KEY?.trim();
    switch (this.provider) {
      case 'openai':
        return this.toolsOpenAI(key!, messages, tools);
      case 'anthropic':
        return this.toolsAnthropic(key!, messages, tools);
      case 'ollama':
        return this.toolsOllama(messages, tools);
    }
  }

  /** Ollama 네이티브 /api/chat — tools 배열과 tool_calls를 그대로 지원한다. */
  private async toolsOllama(messages: HarnessMessage[], tools: LlmToolSpec[]): Promise<LlmTurn> {
    const base = (process.env.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434').replace(/\/+$/, '');
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: messages.map((m) => {
          if (m.role === 'assistant') {
            return {
              role: 'assistant',
              content: m.content,
              ...(m.toolCalls?.length
                ? { tool_calls: m.toolCalls.map((tc) => ({ function: { name: tc.name, arguments: tc.arguments } })) }
                : {}),
            };
          }
          if (m.role === 'tool') return { role: 'tool', content: m.content };
          return { role: m.role, content: m.content };
        }),
        ...(tools.length
          ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
          : {}),
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { message?: { content?: string; tool_calls?: any[] } };
    const msg = data.message ?? {};
    return {
      content: String(msg.content ?? ''),
      toolCalls: (Array.isArray(msg.tool_calls) ? msg.tool_calls : [])
        .map((c: any, i: number) => ({
          id: String(c?.id ?? `call_${i + 1}`),
          name: String(c?.function?.name ?? c?.name ?? ''),
          arguments: normalizeToolArguments(c?.function?.arguments ?? c?.arguments),
        }))
        .filter((c) => c.name.length > 0),
    };
  }

  /** OpenAI Chat Completions — tools/tool_calls 및 tool 역할 메시지. */
  private async toolsOpenAI(key: string, messages: HarnessMessage[], tools: LlmToolSpec[]): Promise<LlmTurn> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        messages: messages.map((m) => {
          if (m.role === 'assistant') {
            return {
              role: 'assistant',
              content: m.content ?? '',
              ...(m.toolCalls?.length
                ? {
                    tool_calls: m.toolCalls.map((tc) => ({
                      id: tc.id,
                      type: 'function',
                      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                    })),
                  }
                : {}),
            };
          }
          if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
          return { role: m.role, content: m.content };
        }),
        ...(tools.length
          ? {
              tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
              tool_choice: 'auto',
            }
          : {}),
      }),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string; tool_calls?: any[] } }> };
    const msg = data.choices?.[0]?.message ?? {};
    return {
      content: String(msg.content ?? ''),
      toolCalls: (Array.isArray(msg.tool_calls) ? msg.tool_calls : [])
        .map((c: any, i: number) => ({
          id: String(c?.id ?? `call_${i + 1}`),
          name: String(c?.function?.name ?? ''),
          arguments: normalizeToolArguments(c?.function?.arguments),
        }))
        .filter((c) => c.name.length > 0),
    };
  }

  /** Anthropic Messages — tools/tool_use, 도구 결과는 user 메시지의 tool_result 블록으로 되돌린다. */
  private async toolsAnthropic(key: string, messages: HarnessMessage[], tools: LlmToolSpec[]): Promise<LlmTurn> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    const anthropicMessages: any[] = [];
    for (const m of rest) {
      if (m.role === 'user') {
        anthropicMessages.push({ role: 'user', content: m.content });
      } else if (m.role === 'system') {
        // system은 위에서 분리했다 — 방어적 분기
        anthropicMessages.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        const blocks: any[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        anthropicMessages.push({ role: 'assistant', content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }] });
      } else {
        const toolMsg = m as Extract<HarnessMessage, { role: 'tool' }>;
        const block = { type: 'tool_result', tool_use_id: toolMsg.toolCallId, content: toolMsg.content };
        const last = anthropicMessages[anthropicMessages.length - 1];
        if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
          last.content.push(block); // 연속 도구 결과는 한 user 메시지로 묶는다
        } else {
          anthropicMessages.push({ role: 'user', content: [block] });
        }
      }
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system,
        messages: anthropicMessages,
        ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { content?: any[] };
    const blocks = Array.isArray(data.content) ? data.content : [];
    return {
      content: blocks.filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')).join(''),
      toolCalls: blocks
        .filter((b) => b?.type === 'tool_use')
        .map((b) => ({ id: String(b.id), name: String(b.name), arguments: normalizeToolArguments(b.input) })),
    };
  }

  /**
   * 표시·광고 문구 판정 (이슈 #19) — 근거 조문에 근거해서 허용/주의/금지 판정.
   * 근거에 근거 없는 판정은 'undetermined'(사유 포함)로 강제한다(출처 없는 생성 금지).
   * LLM 응답은 JSON으로 강제하며, 파싱 실패·형식 이탈은 undetermined로 안전 폴백한다.
   */
  async judgeAdvertisement(
    text: string,
    sources: Array<{ law_name: string; law_type: string; article_no: string; article_title?: string | null; content: string }>,
  ): Promise<{ ok: boolean; verdict?: 'allowed' | 'caution' | 'prohibited' | 'undetermined'; reason?: string }> {
    const status = this.check();
    if (!status.active) {
      return { ok: false };
    }
    const context = sources
      .map((a, i) => {
        const title = a.article_title ? ` (${a.article_title})` : '';
        return `[${i + 1}] ${a.law_name} ${a.article_no}${title}\n${a.content.slice(0, 500)}`;
      })
      .join('\n\n');
    const system =
      '당신은 건강기능식품 표시·광고 사전검증 보조 어시스턴트입니다. ' +
      '제공된 근거 조문에 근거해서만 판정하고, 근거에 없는 표준은 만들지 마세요. ' +
      '판정 기준: 질병 치료·예방 효과 표시나 허위·과장 문구는 금지(prohibited), ' +
      '기능성 범위를 넘거나 각주·주의 문구가 필요한 표기는 주의(caution), ' +
      '근거 조문상 문제 없는 기능성 문구는 허용(allowed). ' +
      '근거 조문으로 판정할 수 없으면 undetermined와 사유를 말하세요. ' +
      '반드시 아래 JSON만 출력하세요(다른 텍스트 금지): {"verdict":"allowed|caution|prohibited|undetermined","reason":"한국어 사유"}';
    const user = `판정할 문구: ${text}\n\n근거 조문:\n${context}`;
    try {
      const raw = await this.call(system, user);
      const jsonText = raw.slice(Math.max(raw.indexOf('{'), 0), raw.lastIndexOf('}') + 1);
      const parsed = JSON.parse(jsonText) as { verdict?: string; reason?: string };
      const allowed = ['allowed', 'caution', 'prohibited', 'undetermined'];
      if (!parsed.verdict || !['allowed', 'caution', 'prohibited', 'undetermined'].includes(parsed.verdict)) {
        return { ok: false, reason: 'LLM 판정 형식이 유효하지 않습니다.' };
      }
      return { ok: true, verdict: parsed.verdict as 'allowed' | 'caution' | 'prohibited' | 'undetermined', reason: parsed.reason ?? '' };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.logger.warn(`문구 판정 실패 (${status.provider}/${status.model}): ${msg}`);
      return { ok: false, reason: msg };
    }
  }
}