'use client';
import { useRouter } from 'next/navigation';
import type { Auth } from '../../lib/auth';
import { clearAuth } from '../../lib/auth';
import { colors, radius, font, btnSecondary } from '../../lib/design';

const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 20px', background: colors.ink, color: '#F3F0EE', gap: 12,
  fontFamily: font.family,
};

/**
 * 워크스페이스 공통 상단 바(DESIGN.md 잉크 바): 워크스페이스명 + 로그인 계정·역할 배지 + 로그아웃.
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
        <strong style={{ fontSize: 16, letterSpacing: '-0.3px' }}>Nutrition Mind</strong>
        <span style={{ fontSize: 14, opacity: 0.9 }}>| {title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
        <span
          style={{
            background: colors.linkBlue, borderRadius: radius.pill, padding: '3px 10px',
            fontSize: 12, fontWeight: 700,
          }}
          data-testid="role-badge"
        >
          {auth.roleLabel}
        </span>
        <span style={{ opacity: 0.85 }}>{auth.email}</span>
        <button onClick={logout} style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12 }}>
          로그아웃
        </button>
      </div>
    </header>
  );
}