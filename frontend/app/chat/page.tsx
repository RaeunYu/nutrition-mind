'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import WorkspaceHeader from '../_components/workspace-header';
import Spinner from '../_components/spinner';
import { BACKEND, getAuth, type Auth } from '../../lib/auth';
import { pageContainer, btnPrimary } from '../../lib/design';

const inputStyle: React.CSSProperties = { display: 'block', width: '100%', padding: 10, marginBottom: 8, boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { padding: '10px 16px', cursor: 'pointer' };

interface CustomerOption {
  id: string;
  name: string;   // 마스킹
}

/**
 * 상담 챗봇 페이지 (이슈 #18) — 로그인·워크스페이스와 분리된 별도 화면.
 * 고객을 선택하면 섭취 제품·성분·성분 갭이 질의 컨텍스트로 주입된다(백엔드 /chat/chat customerId 파라미터).
 * 고객 미선택 시 기존 법령·기능성 답변 동작을 그대로 유지한다(회귀 없음).
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
  const [error, setError] = useState('');

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
    setBusy(true); setAnswer(''); setNotices([]);
    try {
      const res = await fetch(`${BACKEND}/chat/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify(customerId ? { question, customerId } : { question }),
      });
      const data = await res.json();
      setAnswer(typeof data.answer === 'string' ? data.answer : JSON.stringify(data, null, 2));
      setNotices(Array.isArray(data.notices) ? data.notices : []);
      if (data?.customerContext?.applied === false && customerId && data.notices) {
        // 고객 조회 실패 등 — notices로 사유 표시
      }
    } catch (e) {
      setAnswer('요청 실패: ' + String(e));
    } finally { setBusy(false); }
  }, [auth, customerId, question]);

  if (!auth) {
    return <main style={{ padding: 40, color: '#64748b' }}>인증 확인 중…</main>;
  }

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
          {notices.length > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 18, color: '#64748b', fontSize: 12 }}>
              {notices.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
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