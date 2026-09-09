'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import WorkspaceHeader from '../_components/workspace-header';
import { ROLE_HOME, getAuth, type Auth } from '../../lib/auth';

const cardStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, background: '#fff',
};

/**
 * 마케팅 화면 골격 — 제품기획·마케팅 담당자 전용 홈.
 * 본 이슈(#11)는 구조만 제공하며, 문구 검증(#19)·기능성·원료 리서치 조회(#20)가 이 자리를 채운다.
 */
export default function MarketingPage() {
  const router = useRouter();
  const [auth, setAuthState] = useState<Auth | null>(null);

  // 미인증 → 로그인, 타 역할 → 각자의 홈으로 분기
  useEffect(() => {
    const a = getAuth();
    if (!a) { router.replace('/login'); return; }
    if (a.role !== 'marketing') { router.replace(ROLE_HOME[a.role]); return; }
    setAuthState(a);
  }, [router]);

  if (!auth) {
    return <main style={{ padding: 40, color: '#64748b' }}>인증 확인 중…</main>;
  }

  return (
    <div>
      <WorkspaceHeader title="마케팅 워크스페이스" auth={auth} />
      <main style={{ maxWidth: 860, margin: '24px auto', padding: 24 }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>제품기획·마케팅 워크스페이스</h1>
        <p style={{ color: '#64748b' }}>
          표시·광고 문구 검증과 제품·원료 정보를 다루는 화면입니다. (고객 개인정보에는 접근하지 않습니다)
        </p>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 24 }}>
          <section style={cardStyle}>
            <h2 style={{ fontSize: 16, margin: 0 }}>문구 검증</h2>
            <p style={{ fontSize: 14, color: '#475569' }}>
              표시·광고 문구의 허용 가능 여부를 표시기준·법령 근거와 함께 판정하는 기능. <strong>이슈 #19</strong>에서 구현.
            </p>
          </section>
          <section style={cardStyle}>
            <h2 style={{ fontSize: 16, margin: 0 }}>기능성·원료 리서치 조회</h2>
            <p style={{ fontSize: 14, color: '#475569' }}>
              식약처 기능성 정보·품목제조신고 제품 데이터를 조회하는 기능. <strong>이슈 #20</strong>에서 구현.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}