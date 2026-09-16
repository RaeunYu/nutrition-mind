/**
 * 에이전트 하네스 루프 테스트 (Epic #3 · T5 #37).
 * 실행: npm run test:harness (tsx test/agent-harness.test.ts)
 *
 * **스텁 LLM·스텁 카탈로그**로 루프 메커니즘만 검증한다 — 실제 LLM·MCP 서버가 필요 없다.
 * 검증: A(사전 주입) 루프 · B(동적 발견) 재선언 · 최대 반복 · 도구 오류 전달 · 라우팅 실패 폴백.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentHarnessService, LIST_TOOLS_NAME, MAX_HARNESS_ITERATIONS } from '../src/agent-harness.service';
import type { ToolDescriptor } from '../src/mcp-tool-catalog.service';

const SHIPPING: ToolDescriptor = {
  name: 'list_customer_shipments',
  description: '고객 배송 목록',
  category: '배송',
  inputSchema: { type: 'object', properties: { customer_id: { type: 'string' } }, required: ['customer_id'] },
  required: ['customer_id'],
};
const BOOM: ToolDescriptor = {
  name: 'boom',
  description: '항상 실패하는 도구(오류 경로 테스트용)',
  category: '배송',
  inputSchema: { type: 'object', properties: {}, required: [] },
  required: [],
};
const ORDER: ToolDescriptor = {
  name: 'list_customer_orders',
  description: '고객 주문 목록',
  category: '주문·결제',
  inputSchema: { type: 'object', properties: {}, required: [] },
  required: [],
};

/** 호출될 때마다 스크립트의 다음 턴을 돌려주는 스텁 LLM. */
class FakeLlm {
  calls: Array<{ toolsOffered: string[]; messages: any[] }> = [];
  constructor(private readonly script: Array<(tools: string[]) => { content: string; toolCalls: any[] }>) {}
  async chatWithTools(messages: any[], tools: any[]) {
    this.calls.push({ toolsOffered: tools.map((t) => t.name), messages: JSON.parse(JSON.stringify(messages)) });
    const step = this.script[Math.min(this.calls.length - 1, this.script.length - 1)];
    return { ok: true, turn: step(tools.map((t: any) => t.name)), provider: 'fake', model: 'fake' };
  }
}

/** 호출 기록을 남기는 스텁 카탈로그. */
function fakeCatalog() {
  const executed: Array<{ name: string; args: any; actor: any }> = [];
  return {
    executed,
    async listCategories() {
      return [
        { category: '배송', toolCount: 1, tools: [SHIPPING.name] },
        { category: '주문·결제', toolCount: 1, tools: [ORDER.name] },
      ];
    },
    async listByCategory(category: string) {
      return [SHIPPING, BOOM, ORDER].filter((t) => t.category === category);
    },
    async listByCategories(categories: string[]) {
      return [SHIPPING, BOOM, ORDER].filter((t) => categories.includes(t.category));
    },
    async listTools() {
      return [SHIPPING, BOOM, ORDER];
    },
    async callTool(name: string, args: any, actor: any) {
      executed.push({ name, args, actor });
      if (name === 'boom') return { ok: false, tool: name, category: '배송', error: '도구 폭발', latencyMs: 1 };
      return { ok: true, tool: name, category: '배송', result: { found: true, tool: name, args }, latencyMs: 2 };
    },
    async onModuleDestroy() {},
  };
}

function fakeRouter(decisionOverrides: any = {}) {
  return {
    async route(_q: string, options: any = {}) {
      return {
        method: options.method ?? 'embedding',
        candidates: [
          { category: '배송', score: 0.72 },
          { category: '주문·결제', score: 0.4 },
        ],
        picked: ['배송'],
        belowThreshold: false,
        threshold: 0.36,
        latencyMs: 3,
        ...decisionOverrides,
      };
    },
    async categories() {
      return ['배송', '주문·결제', '고객·성분', '법령·기능성'];
    },
  };
}

const toolCall = (name: string, args: any = {}, id = 'call_1') => ({ id, name, arguments: args });

test('A 모드(사전 주입) — 선택 카테고리 도구만 주입되고, tool_call 실행 후 최종 답변까지 돈다', async () => {
  const llm = new FakeLlm([
    () => ({ content: '', toolCalls: [toolCall(SHIPPING.name, { customer_id: 'c1' })] }),
    () => ({ content: '김건강 고객의 배송은 지연 상태입니다.', toolCalls: [] }),
  ]);
  const catalog = fakeCatalog();
  const harness = new AgentHarnessService(llm as any, catalog as any, fakeRouter() as any);

  const result = await harness.run({ question: '배송이 안 와요', mode: 'prefill', actor: { email: 'a@b.c', role: 'consultant' } });

  assert.equal(result.answer, '김건강 고객의 배송은 지연 상태입니다.');
  assert.equal(result.iterations, 2);
  assert.deepEqual(result.usedToolCalls, [SHIPPING.name]);
  // A 모드: 첫 호출에 배송 카테고리 도구만 주입(메타 도구 없음)
  assert.deepEqual(llm.calls[0].toolsOffered, [SHIPPING.name, BOOM.name]);
  // 도구는 하네스가 실제 실행하고, actor가 전달된다
  assert.deepEqual(catalog.executed, [{ name: SHIPPING.name, args: { customer_id: 'c1' }, actor: { email: 'a@b.c', role: 'consultant' } }]);
  // 도구 결과가 다음 LLM 호출의 메시지에 tool 역할로 들어간다
  const toolMsg = llm.calls[1].messages.find((m: any) => m.role === 'tool');
  assert.ok(toolMsg, '도구 결과 메시지가 컨텍스트에 들어간다');
  assert.match(toolMsg.content, /"found":true/);

  const types = result.trace.map((s) => s.type);
  assert.deepEqual(types, ['router', 'llm_call', 'tool_call', 'tool_result', 'llm_call', 'final']);
  assert.equal(result.trace.at(-1)!.answered, true);
});

test('B 모드(동적 발견) — list_tools로 카테고리를 고르고, 하네스가 도구를 재선언한다', async () => {
  const llm = new FakeLlm([
    // 1턴: 메타 도구만 주입 → LLM이 카테고리를 골라 목록을 요청
    (tools) => {
      assert.deepEqual(tools, [LIST_TOOLS_NAME], 'B 모드 첫 호출에는 메타 도구만 있어야 한다');
      return { content: '', toolCalls: [toolCall(LIST_TOOLS_NAME, { category: '배송' })] };
    },
    // 2턴: 하네스가 재선언한 도구로 실제 도구 호출
    (tools) => {
      assert.deepEqual(tools, [SHIPPING.name, BOOM.name], '재선언된 도구가 주입되어야 한다');
      return { content: '', toolCalls: [toolCall(SHIPPING.name, { customer_id: 'c1' }, 'call_2')] };
    },
    () => ({ content: '배송 지연으로 확인됩니다.', toolCalls: [] }),
  ]);
  const catalog = fakeCatalog();
  const harness = new AgentHarnessService(llm as any, catalog as any, fakeRouter() as any);

  const result = await harness.run({ question: '배송 어때요', mode: 'discover' });

  assert.equal(result.answer, '배송 지연으로 확인됩니다.');
  assert.equal(result.iterations, 3);
  assert.deepEqual(result.usedToolCalls, [LIST_TOOLS_NAME, SHIPPING.name]);
  assert.equal(llm.calls[0].toolsOffered[0], LIST_TOOLS_NAME);
  assert.deepEqual(llm.calls[1].toolsOffered, [SHIPPING.name, BOOM.name]);
  const metaMsg = llm.calls[1].messages.find((m: any) => m.role === 'tool' && m.name === LIST_TOOLS_NAME);
  assert.ok(metaMsg, 'list_tools 결과가 컨텍스트에 들어간다');
  assert.match(metaMsg.content, /list_customer_shipments/);
});

test('최대 반복(3회)에서 멈추고 사유를 남긴다 — 무한 루프 방지', async () => {
  const llm = new FakeLlm([() => ({ content: '', toolCalls: [toolCall(SHIPPING.name, { customer_id: 'c1' })] })]);
  const harness = new AgentHarnessService(llm as any, fakeCatalog() as any, fakeRouter() as any);

  const result = await harness.run({ question: '배송', mode: 'prefill' });

  assert.equal(result.answer, null);
  assert.equal(result.iterations, MAX_HARNESS_ITERATIONS);
  assert.match(result.reason ?? '', /최대 반복/);
  assert.equal(result.trace.filter((s) => s.type === 'llm_call').length, MAX_HARNESS_ITERATIONS);
  assert.equal(result.notices.some((n) => n.includes('최대 반복')), true);
});

test('도구 오류는 예외가 아니라 {error} tool_result로 모델에 전달된다', async () => {
  const llm = new FakeLlm([
    () => ({ content: '', toolCalls: [toolCall('boom', {})] }),
    () => ({ content: '도구 오류로 확인하지 못했습니다.', toolCalls: [] }),
  ]);
  const harness = new AgentHarnessService(llm as any, fakeCatalog() as any, fakeRouter() as any);

  const result = await harness.run({ question: '배송', mode: 'prefill' });

  const failure = result.trace.find((s) => s.type === 'tool_result' && s.ok === false);
  assert.ok(failure, '실패 tool_result가 trace에 남는다');
  assert.equal(failure!.summary, '도구 폭발');
  const toolMsg = llm.calls[1].messages.find((m: any) => m.role === 'tool');
  assert.match(toolMsg.content, /"error":"도구 폭발"/);
  assert.equal(result.answer, '도구 오류로 확인하지 못했습니다.', '루프가 죽지 않고 모델이 마무리한다');
});

test('라우팅 실패 시 예외 없이 answer=null + 사유를 반환한다(컨트롤러가 폴백)', async () => {
  const router = {
    async route() {
      throw new Error('임베딩 서버 연결 실패');
    },
    async categories() {
      return ['배송'];
    },
  };
  const harness = new AgentHarnessService(new FakeLlm([]) as any, fakeCatalog() as any, router as any);

  const result = await harness.run({ question: '배송', mode: 'prefill' });

  assert.equal(result.answer, null);
  assert.match(result.reason ?? '', /도구 라우팅 실패/);
  assert.equal(result.routing, null);
  assert.deepEqual(result.usedToolCalls, []);
});

test('임계값 미달(top-2 병합)이면 두 카테고리 도구가 함께 주입된다', async () => {
  const llm = new FakeLlm([() => ({ content: '두 카테고리를 함께 봤습니다.', toolCalls: [] })]);
  const router = fakeRouter({ picked: ['배송', '주문·결제'], belowThreshold: true });
  const harness = new AgentHarnessService(llm as any, fakeCatalog() as any, router as any);

  const result = await harness.run({ question: '애매한 질문', mode: 'prefill' });

  assert.deepEqual(llm.calls[0].toolsOffered, [SHIPPING.name, BOOM.name, ORDER.name]);
  assert.deepEqual((result.routing as any).picked, ['배송', '주문·결제']);
});
