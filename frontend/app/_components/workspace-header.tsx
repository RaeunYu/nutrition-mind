'use client';
import { useRouter } from 'next/navigation';
import type { Auth } from '../../lib/auth';
import { clearAuth } from '../../lib/auth';

const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 20px', background: '#0f172a', color: '#fff', gap: 12,
};

/**
 * 워크스페이스 공통 상단 바: 워크스페이스명 + 로그인 계정·역할 배지 + 로그아웃.
 * 각 역할 홈(/, /marketing, /admin)에서 공유한다.
 */
export default function WorkspaceHeader({ title, auth }: { title: string; auth: Auth }) {
  const router = useRouter();

  function logout() {
    clearAuth();
    router.replace('/login');
  }

  return (
    <header style={headerStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <strong style={{ fontSize: 16 }}>Nutrition Mind</strong>
        <span style={{ fontSize: 14, opacity: 0.9 }}>| {title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
        <span
          style={{
            background: '#1d4ed8', borderRadius: 999, padding: '3px 10px',
            fontSize: 12, fontWeight: 600,
          }}
          data-testid="role-badge"
        >
          {auth.roleLabel}
        </span>
        <span style={{ opacity: 0.85 }}>{auth.email}</span>
        <button
          onClick={logout}
          style={{ padding: '4px 10px', cursor: 'pointer', borderRadius: 6, border: 'none' }}
        >
          로그아웃
        </button>
      </div>
    </header>
  );
}