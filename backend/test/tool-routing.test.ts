/**
 * 도구 라우팅 골드셋 측정 (Epic #3 · T4 #36).
 * 실행: npm run test:tool-routing (tsx test/tool-routing.test.ts)
 *
 * 전제: Ollama(qwen3-embedding:0.6b) + MCP 서버 구동 중. 호스트 실행이므로 OLLAMA_BASE_URL을
 * localhost로 맞춘다(컨테이너용 host.docker.internal은 호스트에서 해석되지 않음).
 *
 * 합격선(Q19 확정): 임베딩 ≥ 0.80 / LLM ≥ 0.90. 복합 의도 4문항은 top-2 병합 recall로 별도 측정한다.
 */
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

const ROOT = resolve(process.cwd(), '..');
loadEnv({ path: resolve(ROOT, '.env') });
// 호스트 실행 오버라이드 — 컨테이너 전용 URL이면 localhost로 바꾼다.
if (!process.env.OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL.includes('host.docker.internal')) {
  process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
}

import { McpToolCatalogService, CATEGORY_ORDER } from '../src/mcp-tool-catalog.service';
import { LlmService } from '../src/llm.service';
import { ToolRouterService, DEFAULT_ROUTER_THRESHOLD } from '../src/tool-router.service';

interface GoldenItem {
  id: string;
  question: string;
  expected: string[];
  compound?: boolean;
}

const goldenset = JSON.parse(readFileSync(resolve(process.cwd(), 'test', 'tool-routing-goldenset.json'), 'utf8')) as {
  questions: GoldenItem[];
};

const catalog = new McpToolCatalogService();
const router = new ToolRouterService(catalog, new LlmService());

after(async () => {
  await catalog.onModuleDestroy();
});

/**
 * 단일 의도 정확도: 기대 카테고리가 picked에 있는가.
 * 복합 의도 recall(Q19 확정): **top-2 병합 시** 기대 카테고리가 모두 포함되는 비율 —
 *  임베딩은 상위 2개 후보(병합 안전장치가 제공하는 집합), LLM은 실제 picked를 쓴다.
 */
function measure(results: Array<{ item: GoldenItem; picked: string[]; considered: string[] }>) {
  const singles = results.filter((r) => !r.item.compound);
  const compounds = results.filter((r) => r.item.compound);
  const singleHits = singles.filter((r) => r.picked.includes(r.item.expected[0])).length;
  const compoundRecall = compounds.reduce((sum, r) => {
    const hit = r.item.expected.filter((c) => r.considered.includes(c)).length;
    return sum + hit / r.item.expected.length;
  }, 0);
  return {
    singleAccuracy: singles.length ? singleHits / singles.length : 0,
    compoundRecall: compounds.length ? compoundRecall / compounds.length : 0,
    correct: singles.map((r) => r.picked.includes(r.item.expected[0])),
    misses: singles.filter((r) => !r.picked.includes(r.item.expected[0])),
  };
}

test('임베딩 라우터 — 골드셋 단일 의도 정확도 ≥ 0.80', async () => {
  const categories = await router.categories();
  assert.deepEqual(categories, [...CATEGORY_ORDER], '카탈로그 카테고리가 4종이어야 한다');

  const results = [];
  for (const item of goldenset.questions) {
    const decision = await router.route(item.question, { method: 'embedding' });
    results.push({ item, picked: decision.picked, considered: decision.candidates.slice(0, 2).map((c) => c.category) });
  }
  const m = measure(results);
  console.log(
    `\n[임베딩] 단일 의도 정확도 ${(m.singleAccuracy * 100).toFixed(1)}% (${m.correct.filter(Boolean).length}/${m.correct.length})` +
      ` · 복합 의도 top-2 병합 recall ${(m.compoundRecall * 100).toFixed(1)}% · 임계값 ${DEFAULT_ROUTER_THRESHOLD}`,
  );
  if (m.misses.length > 0) {
    console.log('  오분류:', m.misses.map((r) => `${r.item.id}「${r.item.question}」→ ${r.picked.join('+')} (기대 ${r.item.expected[0]})`).join(' / '));
  }
  assert.ok(m.singleAccuracy >= 0.8, `임베딩 정확도 ${m.singleAccuracy} < 0.80`);
  assert.ok(m.compoundRecall >= 0.75, `복합 의도 top-2 병합 recall ${m.compoundRecall} < 0.75`);
});

test('라우팅 결정 구조 — 후보 점수·임계값·지연이 담긴다', async () => {
  const decision = await router.route('김건강 고객 배송이 안 와요', { method: 'embedding' });
  assert.equal(decision.method, 'embedding');
  assert.ok(decision.candidates.length >= 4, '카테고리 4종의 후보 점수가 담긴다');
  assert.equal(decision.candidates[0].category, '배송');
  assert.equal(decision.picked[0], '배송');
  assert.equal(decision.threshold, DEFAULT_ROUTER_THRESHOLD);
  assert.ok(decision.latencyMs >= 0, '지연이 기록된다');
  assert.deepEqual(
    decision.candidates.map((c) => c.score),
    [...decision.candidates.map((c) => c.score)].sort((a, b) => b - a),
    '후보는 점수 내림차순',
  );
});

test('임계값 미달이면 상위 2개 카테고리를 병합한다(Q13 안전장치)', async () => {
  const decision = await router.routeByEmbedding('음 어떻게 해야 하죠', 0.99);
  assert.equal(decision.belowThreshold, true);
  assert.equal(decision.picked.length, 2, `picked=${decision.picked.join('+')}`);
});

test('LLM 라우터 — 골드셋 정확도를 측정한다(합격선 ≥ 0.90, LLM 비활성 시 건너뜀)', async () => {
  const llm = new LlmService();
  const status = llm.check();
  if (!status.active) {
    console.log(`\n[LLM] 비활성(${status.reason}) — 측정을 건너뜁니다.`);
    return;
  }
  const results = [];
  for (const item of goldenset.questions) {
    const decision = await router.route(item.question, { method: 'llm' });
    results.push({ item, picked: decision.picked, considered: decision.picked });
  }
  const m = measure(results);
  console.log(
    `\n[LLM ${status.provider}/${status.model}] 단일 의도 정확도 ${(m.singleAccuracy * 100).toFixed(1)}%` +
      ` (${m.correct.filter(Boolean).length}/${m.correct.length}) · 복합 의도 top-2 recall ${(m.compoundRecall * 100).toFixed(1)}%`,
  );
  if (m.misses.length > 0) {
    console.log('  오분류:', m.misses.map((r) => `${r.item.id}「${r.item.question}」→ ${r.picked.join('+')} (기대 ${r.item.expected[0]})`).join(' / '));
  }
  assert.ok(m.singleAccuracy >= 0.9, `LLM 정확도 ${m.singleAccuracy} < 0.90`);
});
