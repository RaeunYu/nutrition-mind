'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import WorkspaceHeader from './_components/workspace-header';
import { ROLE_HOME, getAuth, type Auth } from '../lib/auth';

const cardStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, background: '#fff',
};

/**
 * 상담 워크스페이스 홈 — 영업·상담 담당자(기존 데모 계정 포함)의 기본 화면.
 * 챗봇은 별도 페이지(/chat, 이슈 #18)로 분리됐고, 이곳은 이동 허브 역할을 한다.
 */
export default function Page() {
  const router = useRouter();
  const [auth, setAuthState] = useState<Auth | null>(null);

  useEffect(() => {
    const a = getAuth();
    if (!a) { router.replace('/login'); return; }
    if (a.role === 'marketing') { router.replace(ROLE_HOME.marketing); return; }
    setAuthState(a);
  }, [router]);

  if (!auth) {
    return <main style={{ padding: 40, color: '#64748b' }}>인증 확인 중…</main>;
  }

  return (
    <div>
      <WorkspaceHeader title="상담 워크스페이스" auth={auth} />
      <main style={{ maxWidth: 760, margin: '24px auto', padding: 24, background: '#fff', borderRadius: 12 }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>🧪 상담 워크스페이스</h1>
        <p style={{ color: '#666', fontSize: 13 }}>
          고객 상담에 필요한 도구로 이동하세요.
        </p>
        <nav style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          <Link href="/chat" style={{ ...cardStyle, color: 'inherit', textDecoration: 'none' }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>🧪 상담 챗봇</h2>
            <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 0' }}>
              법령·기능성 근거 질의. 고객 선택 시 섭취 제품·성분이 답변에 반영됩니다(이슈 #18).
            </p>
          </Link>
          <Link href="/customers" style={{ ...cardStyle, color: 'inherit', textDecoration: 'none' }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>👥 고객 관리</h2>
            <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 0' }}>
              고객 목록·등록, 섭취 제품 연결, 성분 갭·추천 제안 확인(이슈 #13~#17).
            </p>
          </Link>
        </nav>
      </main>
    </div>
  );
}