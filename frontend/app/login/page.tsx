'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BACKEND, ROLE_HOME, getAuth, setAuth, type Auth, type Role } from '../../lib/auth';
import { colors, pageContainer, btnPrimary, pageH1 } from '../../lib/design';

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: 10, marginBottom: 10,
  border: '1px solid #cbd5e1', borderRadius: 8, boxSizing: 'border-box', fontSize: 14,
};

/** 공개 데모 계정 안내 (비밀번호는 공개 데모 값 — README 참조) */
const DEMO_ACCOUNTS: Array<{ email: string; password: string; role: Role; label: string }> = [
  { email: 'consultant@example.com', password: 'consult1234', role: 'consultant', label: '영업·상담 담당자' },
  { email: 'marketing@example.com', password: 'marketing1234', role: 'marketing', label: '제품기획·마케팅 담당자' },
  { email: 'admin@example.com', password: 'admin1234', role: 'admin', label: '총관리자' },
];

/** 로그인 페이지 — 로그인 성공 시 역할에 따라 워크스페이스로 분기한다. */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('consultant@example.com');
  const [password, setPassword] = useState('consult1234');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 이미 로그인한 담당자는 역할 홈으로 이동
  useEffect(() => {
    const existing = getAuth();
    if (existing) router.replace(ROLE_HOME[existing.role]);
  }, [router]);

  function applyHome(auth: Auth) {
    router.replace(ROLE_HOME[auth.role]);
  }
  function fill(a: { email: string; password: string }) {
    setEmail(a.email);
    setPassword(a.password);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('이메일과 비밀번호를 입력하세요.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`${BACKEND}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.ok) {
        const auth: Auth = {
          accessToken: data.accessToken,
          email: data.email,
          role: data.role as Role,
          roleLabel: data.roleLabel ?? data.role,
        };
        setAuth(auth);
        applyHome(auth);
      } else {
        setError(data.error ?? '로그인 실패');
      }
    } catch {
      setError('로그인 서버에 연결할 수 없습니다. (backend:3001 확인)');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ ...pageContainer, maxWidth: 440, margin: '60px auto' }}>
      <h1 style={{ ...pageH1, fontSize: 22, marginBottom: 4 }}>Nutrition Mind 로그인</h1>
      <p style={{ color: '#64748b', fontSize: 14, marginBottom: 20 }}>
        건강기능식품 법령·기능성 정보 도구 — 담당자 계정으로 로그인하세요.
      </p>

      <form onSubmit={submit} noValidate>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="이메일"
          type="email"
          style={inputStyle}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          type="password"
          style={inputStyle}
        />
        {error && <p style={{ color: '#dc2626', fontSize: 13, margin: '0 0 10px' }}>{error}</p>}
        <button
          type="submit"
          disabled={busy}
          style={{
            width: '100%', padding: 12, cursor: 'pointer', border: 'none',
            borderRadius: 20, background: colors.ink, color: '#F3F0EE', fontSize: 15, fontWeight: 700,
          }}
        >
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>

      <section style={{ marginTop: 28, fontSize: 13, color: '#334155' }}>
        <h2 style={{ fontSize: 14, marginBottom: 8 }}>데모 계정 (공개 값)</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          {DEMO_ACCOUNTS.map((a) => (
            <li
              key={a.email}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px',
              }}
            >
              <span>
                <strong>{a.label}</strong>
                <br />
                <span style={{ color: '#64748b' }}>{a.email} / {a.password}</span>
              </span>
              <button
                type="button"
                onClick={() => fill(a)}
                style={{ padding: '4px 10px', cursor: 'pointer', borderRadius: 6 }}
              >
                채우기
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}