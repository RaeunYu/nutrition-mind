/**
 * MCP 도구 카탈로그·실행 계층 (Epic #3 · T3 #35, ADR-0003).
 *
 * 역할:
 *  1) MCP 서버(/mcp)의 `tools/list`로 도구 카탈로그를 수신·캐시하고 카테고리로 그룹핑한다.
 *     - 카테고리 소스: MCP `_meta.category` 우선, description 선두 `[카테고리: …]` 폴백
 *     - 캐시 TTL 60초 + `refresh()` 강제 갱신. MCP 재시작(연결 오류) 시 클라이언트를 버리고 재연결한다.
 *  2) `tools/call`로 도구를 실행하고 결과를 구조화해 반환한다.
 *     - 타임아웃(MCP_TOOL_TIMEOUT_MS, 기본 10초), 오류·타임아웃은 예외로 터뜨리지 않고 실패 결과로 반환
 *     - 필수 인자 누락은 호출 전에 구조화 실패로 반환
 *  3) 도구 실행 시 actor(X-Actor-Email/X-Actor-Role)를 MCP로 전달한다 — 접근 로그 주체(ADR-0002 개정).
 *     actor별로 MCP 세션을 캐시해 요청마다 핸드셰이크를 반복하지 않는다.
 *
 * ESM 상호운용: @modelcontextprotocol/sdk는 ESM 전용이다. tsc(module=commonjs)는 `import()`를
 * require()로 다운레벨하므로 Function 생성자로 **런타임 동적 import**를 유지한다.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

const esmImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;

/** 라우팅 카테고리 — 표시 순서. */
export const CATEGORY_ORDER = ['배송', '주문·결제', '고객·성분', '법령·기능성'] as const;
/** 카테고리를 알 수 없는 도구의 기본 분류(기존 법령·기능성 동작 보존). */
export const DEFAULT_CATEGORY = '법령·기능성';

const CATEGORY_PREFIX = /^\[카테고리:\s*([^\]]+)\]\s*/;
const CACHE_TTL_MS = 60_000;

export interface ToolDescriptor {
  name: string;
  description: string;
  category: string;
  inputSchema: Record<string, any>;
  required: string[];
}

export interface ToolCategorySummary {
  category: string;
  toolCount: number;
  tools: string[];
}

export interface ToolActor {
  email?: string;
  role?: string;
}

/**
 * 도구 실행 결과 — 단일 인터페이스(성공/실패 필드가 선택).
 * 주의: tsconfig가 strict:false(strictNullChecks off)라 `ok: true|false` 리터럴 유니온 내로잉이
 * 동작하지 않는다. 그래서 판별 유니온 대신 선택 필드를 쓴다.
 */
export interface ToolCallOutcome {
  ok: boolean;
  tool: string;
  category: string;
  /** 성공 시 도구 결과(파싱됨). */
  result?: unknown;
  /** 실패 사유(성공 시 없음). */
  error?: string;
  latencyMs: number;
}

/** MCP tool 객체 → 카탈로그 항목. */
export function mapToolDescriptor(tool: any): ToolDescriptor {
  const rawDescription = String(tool?.description ?? '');
  const fromMeta = tool?._meta?.category ?? tool?.meta?.category;
  const fromPrefix = CATEGORY_PREFIX.exec(rawDescription)?.[1];
  const category = String(fromMeta ?? fromPrefix ?? DEFAULT_CATEGORY).trim() || DEFAULT_CATEGORY;
  const inputSchema = (tool?.inputSchema ?? {}) as Record<string, any>;
  return {
    name: String(tool?.name ?? ''),
    description: rawDescription.replace(CATEGORY_PREFIX, '').trim(),
    category,
    inputSchema,
    required: Array.isArray(inputSchema.required) ? (inputSchema.required as string[]) : [],
  };
}

/** MCP 도구 응답(content 배열) → 값. 텍스트가 JSON이면 파싱한다. */
export function parseToolResult(result: any): unknown {
  const parts = Array.isArray(result?.content) ? result.content : [];
  const texts = parts.filter((p: any) => p?.type === 'text' && typeof p.text === 'string').map((p: any) => p.text);
  if (texts.length === 0) return result?.structuredContent ?? null;
  const joined = texts.join('\n');
  try {
    return JSON.parse(joined);
  } catch {
    return joined;
  }
}

@Injectable()
export class McpToolCatalogService implements OnModuleDestroy {
  private readonly logger = new Logger(McpToolCatalogService.name);
  /** actorKey → 연결된 MCP 클라이언트(핸드셰이크 재사용). */
  private readonly clients = new Map<string, Promise<any>>();
  private tools: ToolDescriptor[] = [];
  private loadedAt = 0;
  private loadPromise: Promise<ToolDescriptor[]> | null = null;

  private get url(): string {
    return process.env.MCP_URL ?? 'http://localhost:8000/mcp';
  }

  private get timeoutMs(): number {
    const raw = Number(process.env.MCP_TOOL_TIMEOUT_MS ?? 10000);
    return Number.isFinite(raw) && raw > 0 ? raw : 10000;
  }

  private async clientFor(actor?: ToolActor): Promise<any> {
    const key = `${actor?.email ?? ''}|${actor?.role ?? ''}`;
    const cached = this.clients.get(key);
    if (cached) {
      try {
        return await cached;
      } catch {
        this.clients.delete(key);
      }
    }
    const created = (async () => {
      const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
        esmImport('@modelcontextprotocol/sdk/client/index.js'),
        esmImport('@modelcontextprotocol/sdk/client/streamableHttp.js'),
      ]);
      const headers: Record<string, string> = {};
      if (actor?.email) headers['X-Actor-Email'] = actor.email;
      if (actor?.role) headers['X-Actor-Role'] = actor.role;
      const transport = new StreamableHTTPClientTransport(new URL(this.url), {
        requestInit: { headers },
      });
      const client = new Client({ name: 'nutrition-mind-harness', version: '1.0.0' }, { capabilities: {} });
      await client.connect(transport);
      return client;
    })();
    this.clients.set(key, created);
    try {
      return await created;
    } catch (e) {
      this.clients.delete(key);
      throw e;
    }
  }

  /** 캐시된 클라이언트를 버린다 — MCP 재시작·연결 오류 시 호출. 끊긴 세션을 기다리지 않는다(비블로킹). */
  private dropClients(): void {
    const pending = [...this.clients.values()];
    this.clients.clear();
    this.tools = [];
    this.loadedAt = 0;
    for (const p of pending) {
      p.then((c) => c?.close?.()).catch(() => {
        /* 이미 끊긴 세션은 무시 */
      });
    }
  }

  /**
   * 도구 카탈로그. TTL 캐시를 쓰며 `force`면 MCP에서 다시 받는다.
   * 연결 실패 시에는 마지막으로 성공한 카탈로그가 있으면 그것을 돌려준다(가용성 우선).
   */
  async listTools(force = false): Promise<ToolDescriptor[]> {
    if (!force && this.tools.length > 0 && Date.now() - this.loadedAt < CACHE_TTL_MS) {
      return this.tools;
    }
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        const client = await this.clientFor();
        const res = await client.listTools();
        const mapped = (res?.tools ?? []).map(mapToolDescriptor).filter((t: ToolDescriptor) => t.name);
        this.tools = mapped;
        this.loadedAt = Date.now();
        return mapped;
      } catch (e: any) {
        this.dropClients();
        if (this.tools.length > 0) {
          this.logger.warn(`도구 카탈로그 갱신 실패 — 캐시 사용: ${e?.message ?? e}`);
          return this.tools;
        }
        throw e;
      } finally {
        this.loadPromise = null;
      }
    })();
    return this.loadPromise;
  }

  /** MCP에서 카탈로그를 강제로 다시 받는다(MCP 재시작 후 무효화 경로). */
  async refresh(): Promise<ToolDescriptor[]> {
    this.dropClients();
    return this.listTools(true);
  }

  /** 카테고리별 요약(표시 순서 → 나머지). */
  async listCategories(): Promise<ToolCategorySummary[]> {
    const tools = await this.listTools();
    const byCategory = new Map<string, string[]>();
    for (const t of tools) {
      if (!byCategory.has(t.category)) byCategory.set(t.category, []);
      byCategory.get(t.category)!.push(t.name);
    }
    const ordered = [
      ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
      ...[...byCategory.keys()].filter((c) => !(CATEGORY_ORDER as readonly string[]).includes(c)).sort(),
    ];
    return ordered.map((category) => ({
      category,
      toolCount: byCategory.get(category)!.length,
      tools: byCategory.get(category)!,
    }));
  }

  /** 카테고리에 속한 도구만 반환(라우팅 사전 필터 입력). */
  async listByCategory(category: string): Promise<ToolDescriptor[]> {
    const tools = await this.listTools();
    return tools.filter((t) => t.category === category);
  }

  /** 여러 카테고리 병합(top-2 병합 등, 라우팅 안전장치). */
  async listByCategories(categories: string[]): Promise<ToolDescriptor[]> {
    const tools = await this.listTools();
    const wanted = new Set(categories);
    return tools.filter((t) => wanted.has(t.category));
  }

  /**
   * 도구 실행. 실패는 예외가 아니라 구조화된 실패 결과로 돌려준다.
   * 도구 오류(`{error}`)도 모델이 읽을 수 있도록 결과에 담아 반환한다.
   * 타임아웃은 **연결 단계까지 포함**해 전체 호출에 적용한다(MCP_TOOL_TIMEOUT_MS).
   */
  async callTool(name: string, args: Record<string, unknown> = {}, actor?: ToolActor): Promise<ToolCallOutcome> {
    const started = Date.now();
    try {
      return await this.withTimeout(this.runTool(name, args, actor, started), this.timeoutMs, '도구 실행');
    } catch (e: any) {
      const message = e?.message ?? String(e);
      // 연결 오류·타임아웃이면 다음 호출이 재연결하도록 클라이언트를 버린다(MCP 재시작 무효화).
      this.dropClients();
      this.logger.warn(`도구 실행 실패(${name}): ${message}`);
      const cached = this.tools.find((t) => t.name === name);
      return { ok: false, tool: name, category: cached?.category ?? DEFAULT_CATEGORY, error: message, latencyMs: Date.now() - started };
    }
  }

  private async runTool(
    name: string,
    args: Record<string, unknown>,
    actor: ToolActor | undefined,
    started: number,
  ): Promise<ToolCallOutcome> {
    const tools = await this.listTools();
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return { ok: false, tool: name, category: DEFAULT_CATEGORY, error: `알 수 없는 도구입니다: ${name}`, latencyMs: Date.now() - started };
    }
    const missing = tool.required.filter((key) => args[key] === undefined || args[key] === null || args[key] === '');
    if (missing.length > 0) {
      return {
        ok: false,
        tool: name,
        category: tool.category,
        error: `필수 인자가 없습니다: ${missing.join(', ')}`,
        latencyMs: Date.now() - started,
      };
    }
    const client = await this.clientFor(actor);
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: this.timeoutMs });
    const parsed = parseToolResult(res);
    const isError = Boolean(res?.isError) || (parsed !== null && typeof parsed === 'object' && 'error' in (parsed as any));
    return {
      ok: !isError,
      tool: name,
      category: tool.category,
      result: parsed,
      error: isError ? String((parsed as any)?.error ?? '도구 실행 오류') : undefined,
      latencyMs: Date.now() - started,
    };
  }

  /** 전체 호출(연결 포함)에 상한을 건다 — 연결이 멈춰도 하네스가 무한 대기하지 않도록. */
  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 타임아웃(${ms}ms)`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.dropClients();
  }
}
