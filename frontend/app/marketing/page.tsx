'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import WorkspaceHeader from '../_components/workspace-header';
import Spinner from '../_components/spinner';
import { BACKEND, ROLE_HOME, getAuth, type Auth } from '../../lib/auth';
import { colors, font, pageContainer, btnPrimary, btnSecondary } from '../../lib/design';

const inputStyle: React.CSSProperties = { display: 'block', width: '100%', padding: 10, marginBottom: 8, boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { padding: '10px 16px', cursor: 'pointer' };

/** DESIGN.md 아이브브라우(마케팅 화면용) — 액센트 점 + 대문자 트래킹. */
const mktEyebrow: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
  color: colors.slateGray, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
  fontFamily: font.family,
};
const mktDot: React.CSSProperties = {
  width: 6, height: 6, borderRadius: '50%', background: colors.lightOrange, display: 'inline-block',
};
const mktTitle: React.CSSProperties = {
  fontSize: 17, fontWeight: 600, letterSpacing: '-0.3px', color: colors.ink,
  margin: '2px 0 10px', fontFamily: font.family,
};

interface Citation {
  law_name: string;
  law_type: string;
  article_no: string;
  excerpt: string;
}

interface CopyCheckResult {
  verdict: 'allowed' | 'caution' | 'prohibited' | 'undetermined';
  reason: string;
  citations: Citation[];
  notices: string[];
}

const VERDICT_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  allowed: { label: '허용', bg: '#dbeafe', color: '#1e40af' },
  caution: { label: '주의', bg: '#fef3c7', color: '#92400e' },
  prohibited: { label: '금지', bg: '#fee2e2', color: '#991b1b' },
  undetermined: { label: '판정 보류', bg: '#f1f5f9', color: '#475569' },
};

/**
 * 마케팅 워크스페이스 — 문구 검증(이슈 #19) + 기능성·원료 리서치 조회(이슈 #20).
 * 고객 개인정보에는 접근하지 않는다(ADR-0002).
 */
export default function MarketingPage() {
  const router = useRouter();
  const [auth, setAuthState] = useState<Auth | null>(null);

  // 문구 검증
  const [text, setText] = useState('');
  const [result, setResult] = useState<CopyCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 리서치 조회(#20)
  const [researchQuery, setResearchQuery] = useState('');
  const [researchResults, setResearchResults] = useState<Array<Record<string, string | null>>>([]);
  const [researchField, setResearchField] = useState<'rawMaterial' | 'product'>('rawMaterial');
  const [researchBusy, setResearchBusy] = useState(false);

  // 미인증 → 로그인, 상담 담당자 → 상담 화면으로 분기
  useEffect(() => {
    const a = getAuth();
    if (!a) { router.replace('/login'); return; }
    if (a.role === 'consultant') { router.replace(ROLE_HOME[a.role]); return; }
    setAuthState(a);
  }, [router]);

  async function check() {
    if (!auth) return;
    if (!text.trim()) { setError('문구를 입력하세요.'); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      const res = await fetch(`${BACKEND}/marketing/copy-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError('검증 실패: ' + String(e));
    } finally { setBusy(false); }
  }

  async function searchResearch() {
    if (!auth) return;
    if (!researchQuery.trim()) { setResearchResults([]); return; }
    setResearchBusy(true);
    try {
      const qs = new URLSearchParams({ query: researchQuery.trim(), field: researchField, limit: '10' });
      const res = await fetch(`${BACKEND}/products/search?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const data = await res.json();
      setResearchResults(Array.isArray(data) ? data : data.items ?? []);
    } catch {
      setResearchResults([]);
    } finally { setResearchBusy(false); }
  }

  if (!auth) {
    return <main style={{ padding: 40, color: '#64748b' }}>인증 확인 중…</main>;
  }

  const badge = result ? VERDICT_LABEL[result.verdict] : null;

  return (
    <div>
      <WorkspaceHeader title="마케팅 워크스페이스" auth={auth} />
      <main style={pageContainer}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>제품기획·마케팅 워크스페이스</h1>
        <p style={{ color: '#64748b', fontSize: 13 }}>
          표시·광고 문구 검증과 제품·원료 정보를 다루는 화면입니다. (고객 개인정보에는 접근하지 않습니다)
        </p>

        <section style={{ marginTop: 20, border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
          <div style={mktEyebrow}><span style={mktDot} />문구 검증</div>
          <h2 style={{ ...mktTitle }}>표시·광고 문구 사전검증</h2>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="예: 유산균 증식 및 유해균 억제에 도움을 줄 수 있음"
            rows={3}
            style={inputStyle}
          />
          <button onClick={() => { void check(); }} disabled={busy} style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center' }}>
            {busy && <Spinner size={13} />}
            {busy ? '판정 중…' : '문구 검증'}
          </button>
          {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
          {result && badge && (
            <div style={{ marginTop: 16, border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }} data-testid="copy-check-result">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 999,
                  background: badge.bg, color: badge.color,
                }}>
                  {badge.label}
                </span>
                <span style={{ fontSize: 13, color: '#475569' }}>판정 결과</span>
              </div>
              <p style={{ margin: '12px 0 0', fontSize: 14 }}>{result.reason || '—'}</p>
              <h3 style={{ fontSize: 13, margin: '16px 0 8px' }}>근거 조문</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {result.citations.map((c, i) => (
                  <li key={i} style={{ padding: 8, borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                    <strong>[{i + 1}] {c.law_name} {c.article_no}</strong>
                    <span style={{ color: '#94a3b8' }}> ({c.law_type})</span>
                    <div style={{ color: '#475569', marginTop: 4 }}>{c.excerpt}…</div>
                  </li>
                ))}
                {result.citations.length === 0 && <li style={{ padding: 8, color: '#94a3b8' }}>근거 없음</li>}
              </ul>
              {result.notices.length > 0 && (
                <ul style={{ marginTop: 12, paddingLeft: 18, color: '#64748b', fontSize: 12 }}>
                  {result.notices.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
            </div>
          )}
        </section>

        <section style={{ marginTop: 24, border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
          <div style={mktEyebrow}><span style={mktDot} />리서치</div>
          <h2 style={{ ...mktTitle }}>기능성·원료 조회</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={researchField} onChange={(e) => setResearchField(e.target.value as 'rawMaterial' | 'product')} style={{ ...inputStyle, marginBottom: 0 }}>
              <option value="rawMaterial">원료명으로 검색</option>
              <option value="product">제품명으로 검색</option>
            </select>
            <input
              style={{ ...inputStyle, marginBottom: 0 }}
              placeholder="예: 유산균"
              value={researchQuery}
              onChange={(e) => setResearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { void searchResearch(); } }}
            />
            <button onClick={() => { void searchResearch(); }} disabled={researchBusy} style={{ ...btnSecondary, display: 'inline-flex', alignItems: 'center' }}>
              {researchBusy && <Spinner size={12} color={colors.ink} />}검색
            </button>
          </div>
          {researchResults.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: 6 }}>제품명·원료</th>
                  <th style={{ padding: 6 }}>기능성</th>
                  <th style={{ padding: 6 }}>1일 섭취량·주의사항</th>
                </tr>
              </thead>
              <tbody>
                {researchResults.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: 6 }}>
                      {(p.productName || p.rawMaterialName || '—')}
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{p.apiCode} · {p.reportNo ?? '—'}</div>
                    </td>
                    <td style={{ padding: 6, fontSize: 12 }}>{(p.functionalityText ?? '').slice(0, 80) || '—'}</td>
                    <td style={{ padding: 6, fontSize: 12 }}>{(p.intakeNote ?? '').slice(0, 100) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {researchResults.length === 0 && researchQuery.trim() !== '' && !researchBusy && (
            <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>검색 결과가 없습니다.</p>
          )}
        </section>
      </main>
    </div>
  );
}