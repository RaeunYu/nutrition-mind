/**
 * MCP 도구 카탈로그·실행 계층 테스트 (Epic #3 · T3 #35).
 * 실행: npm run test:mcp-catalog (tsx test/mcp-tool-catalog.test.ts)
 *
 * 전제: Docker MCP 서버 구동 중(localhost:8000/mcp) + 상거래 시드 완료(김건강 배송 지연).
 * 검증: 카테고리 매핑(순수) · 결과 파싱(순수) · 카탈로그 13종/4카테고리 · 도구 실행 성공 ·
 *       알 수 없는 도구 · 필수 인자 누락 · 연결 실패의 구조화 오류 · actor 헤더 → 접근 로그.
 */
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: resolve(process.cwd(), '..', '.env') });

import { Pool } from 'pg';
import {
  McpToolCatalogService,
  mapToolDescriptor,
  parseToolResult,
  CATEGORY_ORDER,
} from '../src/mcp-tool-catalog.service';

const service = new McpToolCatalogService();
const pg = new Pool({ connectionString: process.env.DATABASE_URL });

after(async () => {
  await service.onModuleDestroy();
  await pg.end();
});

test('카테고리 매핑 — _meta.category 우선, description prefix 폴백, 기본값', () => {
  assert.equal(mapToolDescriptor({ name: 'a', description: '설명', _meta: { category: '배송' } }).category, '배송');
  // _meta가 없으면 description 선두의 [카테고리: …]를 쓴다
  const fromPrefix = mapToolDescriptor({ name: 'b', description: '[카테고리: 주문·결제] 주문 조회' });
  assert.equal(fromPrefix.category, '주문·결제');
  assert.equal(fromPrefix.description, '주문 조회'); // prefix는 설명에서 제거된다
  // 둘 다 없으면 기존 동작 보존을 위해 법령·기능성으로 분류
  assert.equal(mapToolDescriptor({ name: 'c', description: '설명만' }).category, '법령·기능성');
  assert.deepEqual(mapToolDescriptor({ name: 'd', description: 'x', inputSchema: { required: ['q'] } }).required, ['q']);
});

test('결과 파싱 — JSON 텍스트는 객체, 일반 텍스트는 문자열, 빈 응답은 null', () => {
  assert.deepEqual(parseToolResult({ content: [{ type: 'text', text: '{"a":1}' }] }), { a: 1 });
  assert.equal(parseToolResult({ content: [{ type: 'text', text: '평문' }] }), '평문');
  assert.equal(parseToolResult({ content: [] }), null);
});

test('카탈로그 — 도구 13종, 4카테고리(법령·기능성 4 / 배송 3 / 주문·결제 3 / 고객·성분 3)', async () => {
  const tools = await service.listTools();
  assert.equal(tools.length, 13, `도구 수=${tools.length}`);
  assert.ok(tools.every((t) => t.category.length > 0), '모든 도구가 카테고리를 갖는다');

  const categories = await service.listCategories();
  const byName = Object.fromEntries(categories.map((c) => [c.category, c.toolCount]));
  assert.deepEqual(byName, { 배송: 3, '주문·결제': 3, '고객·성분': 3, '법령·기능성': 4 });
  assert.deepEqual(categories.map((c) => c.category), [...CATEGORY_ORDER]); // 표시 순서

  const shipping = await service.listByCategory('배송');
  assert.deepEqual(
    shipping.map((t) => t.name).sort(),
    ['get_shipment_status', 'get_tracking_events', 'list_customer_shipments'],
  );
});

test('도구 실행 성공 — search_customers가 고객을 찾고 결과가 파싱된다', async () => {
  const outcome = await service.callTool('search_customers', { name: '김건강' });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.category, '고객·성분');
  const result = outcome.result as any;
  assert.equal(result.customers[0].name, '김건강');
  assert.ok(result.customers[0].customerId);
  assert.ok(outcome.latencyMs >= 0);
});

test('도구 실행 — 알 수 없는 도구는 구조화된 실패', async () => {
  const outcome = await service.callTool('no_such_tool', {});
  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? '', /알 수 없는 도구/);
});

test('도구 실행 — 필수 인자 누락은 호출 전에 구조화된 실패', async () => {
  const outcome = await service.callTool('search_customers', {}); // name은 필수
  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? '', /필수 인자/);
});

test('도구 실행 — 도구 내부 오류({error})도 구조화된 실패로 반환', async () => {
  // get_shipment_status는 두 인자가 모두 선택이므로 하네스 사전 검증을 통과하고 도구가 오류를 반환한다.
  const outcome = await service.callTool('get_shipment_status', {});
  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? '', /order_no 또는 shipment_id/);
});

test('도구 실행 — 타임아웃은 구조화된 실패로 반환된다(예외 전파 없음)', async () => {
  // 실제 MCP 서버를 상대로 타임아웃 상한만 1ms로 낮춘다 — 왕복(수 ms~)보다 짧아 타임아웃이 이긴다.
  const savedTimeout = process.env.MCP_TOOL_TIMEOUT_MS;
  process.env.MCP_TOOL_TIMEOUT_MS = '1';
  try {
    const isolated = new McpToolCatalogService();
    const started = Date.now();
    const outcome = await isolated.callTool('search_customers', { name: '김건강' });
    assert.equal(outcome.ok, false, JSON.stringify(outcome));
    assert.match(outcome.error ?? '', /타임아웃/, JSON.stringify(outcome));
    assert.ok(Date.now() - started < 3000, `즉시 실패해야 한다: ${Date.now() - started}ms`);
    await isolated.onModuleDestroy();
  } finally {
    if (savedTimeout === undefined) delete process.env.MCP_TOOL_TIMEOUT_MS;
    else process.env.MCP_TOOL_TIMEOUT_MS = savedTimeout;
  }
});

test('actor 헤더 전달 — 도구 호출 주체가 접근 로그에 기록된다(ADR-0002 개정)', async () => {
  const actor = { email: 't3-catalog-test@example.com', role: 'consultant' };
  const outcome = await service.callTool('search_customers', { name: '김건강' }, actor);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));

  const rows = await pg.query(
    "SELECT actor_email, actor_role FROM access_logs WHERE actor_email = $1 ORDER BY accessed_at DESC LIMIT 1",
    [actor.email],
  );
  assert.equal(rows.rows.length, 1, '접근 로그 행이 생성된다');
  assert.equal(rows.rows[0].actor_role, 'consultant');
});
