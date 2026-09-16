'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import WorkspaceHeader from '../_components/workspace-header';
import Spinner from '../_components/spinner';
import { BACKEND, getAuth, type Auth } from '../../lib/auth';
import {
  colors, radius, font, pageContainer, btnPrimary, inputStyle, sectionCard, mutedText, pillBadge,
} from '../../lib/design';

/** 도구 스키마 주입 모드 — A(사전 주입): 라우팅 후 해당 카테고리 도구만 제공, B(동적 발견): list_tools 메타 도구로 탐색 후 재선언. */
type InjectionMode = 'prefill' | 'discover';
/** 라우팅 방식 — 임베딩 유사도 또는 LLM 분류. */
type RouterMethod = 'embedding' | 'llm';

interface CustomerOption {
  id: string;
  name: string;   // 마스킹
}

/** 라우팅 결과(응답 routing 필드) — 백엔드가 아직 반환하지 않으면 null(추적 패널의 라우팅 항목 생략). */
interface RoutingResult {
  method: string;
  candidates: { category: string; score: number }[];
  picked: string[];
}

/** 단일 추적 스텝 — 백엔드 구현이 병행 중이므로 상세 필드는 전부 옵셔널로 방어한다. */
interface TraceStep {
  step: number;
  type: string;
  method?: string;
  picked?: string[];
  iteration?: number;
  toolsOffered?: string[];
  tool?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  summary?: string;
  latencyMs?: number;
  iterations?: number;
  totalLatencyMs?: number;
}

const sectionLabelStyle: React.CSSProperties = { fontSize: 13, color: colors.slateGray, display: 'block', marginBottom: 4, fontFamily: font.family };
const toggleRowStyle: React.CSSProperties = { display: 'flex', gap: 12, marginTop: 8 };
const traceHeadingStyle: React.CSSProperties = { fontSize: 16, letterSpacing: '-0.3px', color: colors.ink, margin: 0, fontFamily: font.family };
const traceSubStyle: React.CSSProperties = { ...mutedText, fontSize: 12, margin: '4px 0 0' };
const traceListStyle: React.CSSProperties = { margin: '10px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, lineHeight: 1.5, color: colors.ink, fontFamily: font.family };
const codeChipStyle: React.CSSProperties = { background: colors.border, color: colors.charcoal, borderRadius: radius.pill, padding: '1px 8px', fontSize: 12, fontFamily: 'inherit' };
const rawJsonStyle: React.CSSProperties = { whiteSpace: 'pre-wrap', background: colors.canvasCream, border: `1px solid ${colors.border}`, borderRadius: radius.stadium, padding: 12, marginTop: 8, fontSize: 12, color: colors.charcoal, overflowX: 'auto', fontFamily: 'inherit' };

/** 방식 코드 → 한국어 표기. */
function routerMethodLabel(method?: string): string {
  if (method === 'embedding') return '임베딩';
  if (method === 'llm') return 'LLM 분류';
  return method || '알 수 없음';
}

/** 목록 → 쉼표 나열(빈 목록은 '없음'). */
function fmtList(items?: string[]): string {
  return items && items.length > 0 ? items.join(', ') : '없음';
}

/** 점수 → 소수 3자리 고정. */
function fmtScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(3) : String(score);
}

/** 응답 routing 필드 방어적 파싱 — 누락·형식 불일치 시 null. 절대 크래시하지 않는다. */
function parseRouting(value: unknown): RoutingResult | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const candidates = Array.isArray(r.candidates)
    ? r.candidates
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({ category: String(c.category ?? ''), score: typeof c.score === 'number' ? c.score : Number(c.score) || 0 }))
    : [];
  return {
    method: typeof r.method === 'string' ? r.method : '',
    candidates,
    picked: Array.isArray(r.picked) ? r.picked.map(String) : [],
  };
}

/** 응답 trace 필드 방어적 파싱 — 배열이 아니면 빈 배열. */
function parseTrace(value: unknown): TraceStep[] {
  if (!Array.isArray(value)) return [];
  return value.map((s, i) => {
    const t = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    return {
      step: typeof t.step === 'number' ? t.step : i + 1,
      type: typeof t.type === 'string' ? t.type : '',
      method: typeof t.method === 'string' ? t.method : undefined,
      picked: Array.isArray(t.picked) ? t.picked.map(String) : undefined,
      iteration: typeof t.iteration === 'number' ? t.iteration : undefined,
      toolsOffered: Array.isArray(t.toolsOffered) ? t.toolsOffered.map(String) : undefined,
      tool: typeof t.tool === 'string' ? t.tool : undefined,
      args: t.args && typeof t.args === 'object' ? (t.args as Record<string, unknown>) : undefined,
      ok: typeof t.ok === 'boolean' ? t.ok : undefined,
      summary: typeof t.summary === 'string' ? t.summary : undefined,
      latencyMs: typeof t.latencyMs === 'number' ? t.latencyMs : undefined,
      iterations: typeof t.iterations === 'number' ? t.iterations : undefined,
      totalLatencyMs: typeof t.totalLatencyMs === 'number' ? t.totalLatencyMs : undefined,
    };
  });
}

/** 추적 스텝 한 건을 읽기 쉬운 한국어 한 줄로 렌더링한다(원본 JSON은 details 토글로 별도 제공). */
function TraceStepRow({ step }: { step: TraceStep }) {
  switch (step.type) {
    case 'router':
      return (
        <>
          <strong>라우팅</strong> — 방식: {routerMethodLabel(step.method)} · 선택 카테고리: {fmtList(step.picked)}
        </>
      );
    case 'llm_call':
      return (
        <>
          <strong>LLM 호출</strong>({step.iteration ?? '?'}회차) — 주입된 도구 {step.toolsOffered?.length ?? 0}개: {fmtList(step.toolsOffered)}
        </>
      );
    case 'tool_call':
      return (
        <>
          <strong>도구 호출</strong>({step.iteration ?? '?'}회차): <code style={codeChipStyle}>{step.tool ?? '알 수 없음'}</code>{' '}
          인자: <code style={codeChipStyle}>{JSON.stringify(step.args ?? {})}</code>
        </>
      );
    case 'tool_result':
      return (
        <>
          <strong>도구 결과</strong>: {step.tool ?? '알 수 없음'}{' '}
          <span style={pillBadge(step.ok === false ? colors.signalOrange : colors.charcoal, step.ok === false ? colors.white : colors.canvasCream)}>
            {step.ok === true ? '성공' : step.ok === false ? '실패' : '알 수 없음'}
          </span>
          {typeof step.latencyMs === 'number' ? ` · ${step.latencyMs}ms` : ''}
          {step.summary ? ` — ${step.summary}` : ''}
        </>
      );
    case 'final':
      return (
        <>
          <strong>완료</strong> — 반복 {step.iterations ?? '?'}회 · 총 지연 {typeof step.totalLatencyMs === 'number' ? `${step.totalLatencyMs}ms` : '알 수 없음'}
        </>
      );
    default:
      return (
        <>
          <strong>단계</strong> — {step.type || '알 수 없음'}
        </>
      );
  }
}

/**
 * 상담 챗봇 페이지 (이슈 #18, T6/Epic #3) — 로그인·워크스페이스와 분리된 별도 화면.
 * 고객을 선택하면 섭취 제품·성분·성분 갭이 질의 컨텍스트로 주입된다(백엔드 /chat/chat customerId 파라미터).
 * 고객 미선택 시 기존 법령·기능성 답변 동작을 그대로 유지한다(회귀 없음).
 * T6: 도구 주입 모드(A 사전 주입/B 동적 발견)·라우팅 방식(임베딩/LLM 분류) 선택과
 * 도구 호출 추적 패널을 제공한다 — 백엔드가 routing/trace를 아직 반환하지 않으면 패널을 숨긴다.
 */
export default function ChatPage() {
  const router = useRouter();
  const [auth, setAuthState] = useState<Auth | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [notices, setNotices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<InjectionMode>('prefill');
  const [routerMethod, setRouterMethod] = useState<RouterMethod>('embedding');
  const [routing, setRouting] = useState<RoutingResult | null>(null);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [rawPayload, setRawPayload] = useState<unknown>(null);

  useEffect(() => {
    const a = getAuth();
    if (!a) { router.replace('/login'); return; }
    if (a.role === 'marketing') { router.replace('/marketing'); return; }
    setAuthState(a);
    fetch(`${BACKEND}/customers`, { headers: { Authorization: `Bearer ${a.accessToken}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setCustomers(Array.isArray(rows) ? rows : []))
      .catch(() => setCustomers([]));
  }, [router]);

  const ask = useCallback(async () => {
    if (!auth) return;
    if (!question.trim()) return;
    setBusy(true); setAnswer(''); setNotices([]); setRouting(null); setTrace([]); setRawPayload(null);
    try {
      // T6 백엔드 계약: 주입 모드(mode)·라우팅 방식(router)을 함께 전달한다.
      const body: Record<string, unknown> = { question, mode, router: routerMethod };
      if (customerId) body.customerId = customerId;
      const res = await fetch(`${BACKEND}/chat/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setAnswer(typeof data.answer === 'string' ? data.answer : JSON.stringify(data, null, 2));
      setNotices(Array.isArray(data.notices) ? data.notices : []);
      setRouting(parseRouting(data.routing));
      setTrace(parseTrace(data.trace));
      setRawPayload({ routing: data.routing, trace: data.trace });
      if (data?.customerContext?.applied === false && customerId && data.notices) {
        // 고객 조회 실패 등 — notices로 사유 표시
      }
    } catch (e) {
      setAnswer('요청 실패: ' + String(e));
    } finally { setBusy(false); }
  }, [auth, customerId, question, mode, routerMethod]);

  if (!auth) {
    return <main style={{ padding: 40, color: '#64748b' }}>인증 확인 중…</main>;
  }

  // 라우팅 결과를 별도 항목으로 먼저 보여주므로, trace 안의 중복 router 스텝은 생략한다.
  const timelineSteps = routing ? trace.filter((s) => s.type !== 'router') : trace;
  const showTracePanel = routing !== null || trace.length > 0;

  return (
    <div>
      <WorkspaceHeader title="상담 챗봇" auth={auth} />
      <main style={pageContainer}>
        <Link href="/" style={{ fontSize: 13, color: '#1d4ed8' }}>← 상담 워크스페이스로</Link>
        <h1 style={{ fontSize: 20, marginTop: 8 }}>🧪 상담 보조 챗봇</h1>
        <p style={{ color: '#666', fontSize: 13 }}>
          건강기능식품 법령·기능성 정보 조회 (RAG·MCP). 고객을 선택하면 섭취 제품·성분이 답변 맥락에 반영됩니다.
        </p>

        <section style={{ marginTop: 12 }}>
          <label style={{ fontSize: 13, color: '#475569', display: 'block', marginBottom: 4 }}>
            상담 고객 선택(선택 — 미선택 시 일반 답변)
          </label>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={inputStyle} data-testid="customer-select">
            <option value="">— 고객 선택 안 함 —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </section>

        <section style={{ marginTop: 12 }}>
          <div style={toggleRowStyle}>
            <div style={{ flex: 1 }}>
              <label htmlFor="injection-mode" style={sectionLabelStyle}>도구 주입 방식</label>
              <select
                id="injection-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as InjectionMode)}
                style={inputStyle}
                data-testid="mode-toggle"
              >
                <option value="prefill">A · 사전 주입</option>
                <option value="discover">B · 동적 발견</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="router-method" style={sectionLabelStyle}>라우팅 방식</label>
              <select
                id="router-method"
                value={routerMethod}
                onChange={(e) => setRouterMethod(e.target.value as RouterMethod)}
                style={inputStyle}
                data-testid="router-toggle"
              >
                <option value="embedding">임베딩</option>
                <option value="llm">LLM 분류</option>
              </select>
            </div>
          </div>
          <p style={traceSubStyle}>
            {mode === 'prefill'
              ? 'A · 사전 주입: 라우터가 카테고리를 먼저 고르고, 그 카테고리의 도구만 LLM에 제공됩니다.'
              : 'B · 동적 발견: LLM이 먼저 list_tools 메타 도구로 카테고리를 찾고, 그 카테고리의 도구가 다시 선언됩니다.'}
          </p>
        </section>

        <section style={{ marginTop: 8 }}>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="예: 건강기능식품 제조업 영업 허가는 어떻게 받나요?"
            rows={3}
            style={inputStyle}
          />
          <button onClick={() => { void ask(); }} disabled={busy} style={{ ...btnPrimary, padding: '10px 16px', display: 'inline-flex', alignItems: 'center' }}>
            {busy && <Spinner size={13} />}
            {busy ? '응답 생성 중…' : '질의하기'}
          </button>
          {busy && (
            <p style={{ ...mutedText, display: 'flex', alignItems: 'center', marginTop: 8 }} data-testid="delay-notice" role="status">
              <Spinner size={14} color={colors.ink} />
              도구 호출로 인해 수 초 걸릴 수 있습니다…
            </p>
          )}
          {notices.length > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 18, color: '#64748b', fontSize: 12 }}>
              {notices.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
          {showTracePanel && (
            <section style={{ ...sectionCard, marginTop: 12 }} data-testid="trace-panel" aria-labelledby="trace-heading">
              <h2 id="trace-heading" style={traceHeadingStyle}>도구 호출 추적</h2>
              <p style={traceSubStyle}>라우팅 → 도구 주입 → 도구 호출 → 답변 생성 순서의 실행 흔적입니다.</p>
              <ol style={traceListStyle}>
                {routing && (
                  <li data-testid="trace-step">
                    <strong>라우팅 결과</strong> — 방식: {routerMethodLabel(routing.method)}
                    {routing.candidates.length > 0 && (
                      <> · 후보: {routing.candidates.map((c) => `${c.category} (${fmtScore(c.score)})`).join(', ')}</>
                    )}
                    {' '}· 선택: {fmtList(routing.picked)}
                  </li>
                )}
                {timelineSteps.map((s, i) => (
                  <li key={`${s.step}-${i}`} data-testid="trace-step">
                    <TraceStepRow step={s} />
                  </li>
                ))}
              </ol>
              <details style={{ marginTop: 10 }}>
                <summary
                  style={{ cursor: 'pointer', fontSize: 12, color: colors.slateGray, fontFamily: font.family }}
                  data-testid="trace-raw-toggle"
                >
                  원본 JSON 보기
                </summary>
                <pre style={rawJsonStyle}>{JSON.stringify(rawPayload ?? { routing, trace }, null, 2)}</pre>
              </details>
            </section>
          )}
          {answer && (
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 16, borderRadius: 8, marginTop: 12 }}>
              {answer}
            </pre>
          )}
        </section>
      </main>
    </div>
  );
}