'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import WorkspaceHeader from './_components/workspace-header';
import { BACKEND, ROLE_HOME, getAuth, type Auth } from '../lib/auth';

const inputStyle: React.CSSProperties = { display: 'block', width: '100%', padding: 10, marginBottom: 8, boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { padding: '10px 16px', cursor: 'pointer' };

/**
 * 상담 워크스페이스 홈 — 영업·상담 담당자(기존 데모 계정 포함)의 기본 화면.
 * 기존 최소 기능 챗봇(법령 RAG 근거 + LLM 합성/폴백)을 그대로 제공한다.
 */
export default function Page() {
  const router = useRouter();
  const [auth, setAuthState] = useState<Auth | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  // 미인증 → 로그인, 마케팅 담당자 → 마케팅 화면으로 분기
  useEffect(() => {
    const a = getAuth();
    if (!a) { router.replace('/login'); return; }
    if (a.role === 'marketing') { router.replace(ROLE_HOME.marketing); return; }
    setAuthState(a);
  }, [router]);

  async function ask() {
    if (!auth) { return; }
    setBusy(true); setAnswer('');
    try {
      const res = await fetch(`${BACKEND}/chat/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setAnswer(typeof data.answer === 'string' ? data.answer : JSON.stringify(data, null, 2));
    } catch (e) {
      setAnswer('요청 실패: ' + String(e));
    } finally { setBusy(false); }
  }

  if (!auth) {
    return <main style={{ padding: 40, color: '#64748b' }}>인증 확인 중…</main>;
  }

  return (
    <div>
      <WorkspaceHeader title="상담 워크스페이스" auth={auth} />
      <main style={{ maxWidth: 720, margin: '24px auto', padding: 24, background: '#fff', borderRadius: 12 }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>🧪 상담 보조 챗봇</h1>
        <p style={{ color: '#666' }}>
          건강기능식품 법령·기능성 정보 조회 (RAG·MCP) — 고객 상담 중 궁금한 조항을 질의하세요.
        </p>

        <section style={{ marginTop: 16 }}>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="예: 건강기능식품 제조업 영업 허가는 어떻게 받나요?"
            rows={3}
            style={inputStyle}
          />
          <button onClick={ask} disabled={busy} style={btnStyle}>
            {busy ? '응답 생성 중…' : '질의하기'}
          </button>
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