'use client';
import { useState } from 'react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

const inputStyle: React.CSSProperties = { display: 'block', width: '100%', padding: 10, marginBottom: 8, boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { padding: '10px 16px', cursor: 'pointer' };

export default function Page() {
  const [email, setEmail] = useState('demo@example.com');
  const [password, setPassword] = useState('demo1234');
  const [token, setToken] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  async function login() {
    const res = await fetch(`${BACKEND}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.ok) { setToken(data.accessToken); alert('로그인 성공'); }
    else alert(data.error ?? '로그인 실패');
  }

  async function ask() {
    if (!token) { alert('먼저 로그인하세요.'); return; }
    setBusy(true); setAnswer('');
    try {
      const res = await fetch(`${BACKEND}/chat/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setAnswer(typeof data.answer === 'string' ? data.answer : JSON.stringify(data, null, 2));
    } catch (e) {
      setAnswer('요청 실패: ' + String(e));
    } finally { setBusy(false); }
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: 24, background: '#fff', borderRadius: 12 }}>
      <h1>🧪 Nutrition Mind 데모</h1>
      <p style={{ color: '#666' }}>건강기능식품 법령·기능성 정보 조회 (RAG·MCP) — 최소 기능 챗봇</p>

      <section style={{ marginTop: 24 }}>
        <h2>1. 로그인 (JWT)</h2>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일" style={inputStyle} />
        <input value={password} type="password" onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호" style={inputStyle} />
        <button onClick={login} style={btnStyle}>로그인</button>
        {token && <span style={{ color: 'green', marginLeft: 8 }}>✔ 인증됨</span>}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>2. 챗봇 질의</h2>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="예: 건강기능식품 제조업 영업 허가는 어떻게 받나요?"
          rows={3}
          style={inputStyle}
        />
        <button onClick={ask} disabled={busy} style={btnStyle}>{busy ? '응답 생성 중…' : '질의하기'}</button>
        {answer && (
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 16, borderRadius: 8, marginTop: 12 }}>
            {answer}
          </pre>
        )}
      </section>
    </main>
  );
}
