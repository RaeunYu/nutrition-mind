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
}
