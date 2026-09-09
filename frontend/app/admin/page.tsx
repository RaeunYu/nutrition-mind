'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import WorkspaceHeader from '../_components/workspace-header';
import { ROLE_HOME, getAuth, type Auth } from '../../lib/auth';

const cardStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, background: '#fff',
};

/**
 * 관리 화면 골격 — 총관리자 전용 홈.
 * 본 이슈(#11)는 구조만 제공하며, 접근 로그 확인 화면(#14)이 이 자리를 채운다.
 */
export default function AdminPage() {
  const router = useRouter();
  const [auth, setAuthState] = useState<Auth | null>(null);

  // 미인증 → 로그인, 타 역할 → 각자의 홈으로 분기
  useEffect(() => {
    const a = getAuth();
    if (!a) { router.replace('/login'); return; }
    if (a.role !== 'admin') { router.replace(ROLE_HOME[a.role]); return; }
    setAuthState(a);
  }, [router]);

  if (!auth) {
    return <main style={{ padding: 40, color: '#64748b' }}>인증 확인 중…</main>;
  }

  return (
    <div>
      <WorkspaceHeader title="관리 화면" auth={auth} />
      <main style={{ maxWidth: 860, margin: '24px auto', padding: 24 }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>총관리자 관리 화면</h1>
        <p style={{ color: '#64748b' }}>
          시스템 운영을 관리하는 화면입니다.
        </p>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 24 }}>
          <section style={cardStyle}>
            <h2 style={{ fontSize: 16, margin: 0 }}>접근 로그 확인</h2>
            <p style={{ fontSize: 14, color: '#475569' }}>
              담당자의 고객 개인정보 접근 기록을 확인하는 기능. <strong>이슈 #14</strong>에서 구현.
            </p>
          </section>
          <section style={cardStyle}>
            <h2 style={{ fontSize: 16, margin: 0 }}>시스템 관리</h2>
            <p style={{ fontSize: 14, color: '#475569' }}>
              담당자 계정·역할 운영 등 시스템 관리 기능. 후속 이슈에서 확장.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}