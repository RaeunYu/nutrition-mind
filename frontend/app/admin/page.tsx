'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import WorkspaceHeader from '../_components/workspace-header';
import { BACKEND, ROLE_HOME, getAuth, type Auth } from '../../lib/auth';
import { pageContainer, btnPrimary, sectionCard } from '../../lib/design';

const cardStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, background: '#fff',
};

interface AccessLogItem {
  id: string;
  actorEmail: string;
  actorRole: string;
  customerId: string;
  accessedAt: string;
}

/**
 * 총관리자 관리 화면 — 접근 로그 확인 (이슈 #14).
 * 영업·상담 담당자의 고객 개인정보(상세 복호화) 접근 기록을 열람한다(ADR-0002).
 */
export default function AdminPage() {
  const router = useRouter();
  const [auth, setAuthState] = useState<Auth | null>(null);
  const [logs, setLogs] = useState<AccessLogItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 미인증 → 로그인, 타 역할 → 각자의 홈으로 분기
  useEffect(() => {
    const a = getAuth();
    if (!a) { router.replace('/login'); return; }
    if (a.role !== 'admin') { router.replace(ROLE_HOME[a.role]); return; }
    setAuthState(a);
  }, [router]);

  const reload = useCallback(async () => {
    if (!auth) return;
    try {
      const res = await fetch(`${BACKEND}/admin/access-logs?limit=100`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (!res.ok) {
        setError('접근 로그 조회 실패');
        return;
      }
      const data = await res.json();
      setLogs(data.items ?? []);
      setError('');
    } catch (e) {
      setError('조회 실패: ' + String(e));
    }
  }, [auth]);

  useEffect(() => { void reload(); }, [reload]);

  if (!auth) {
    return <main style={{ padding: 40, color: '#64748b' }}>인증 확인 중…</main>;
  }

  return (
    <div>
      <WorkspaceHeader title="관리 화면" auth={auth} />
      <main style={{ ...pageContainer, background: 'transparent', border: 'none' }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>총관리자 관리 화면</h1>
        <p style={{ color: '#64748b' }}>
          시스템 운영을 관리하는 화면입니다.
        </p>

        <section style={{ ...cardStyle, marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>접근 로그 — 고객 개인정보 열람 기록</h2>
            <button onClick={() => { void reload(); }} style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 20, border: '1.5px solid #141413', background: '#FCFBFA' }}>
              새로고침
            </button>
          </div>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 8 }}>
            고객 상세 화면(개인정보 복호화 화면)에 대한 담당자 접근 기록입니다(ADR-0002).
          </p>
          {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: 8 }}>접근 시각</th>
                <th style={{ padding: 8 }}>담당자</th>
                <th style={{ padding: 8 }}>역할</th>
                <th style={{ padding: 8 }}>고객 ID</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: 8 }}>{new Date(log.accessedAt).toLocaleString('ko-KR')}</td>
                  <td style={{ padding: 8 }}>{log.actorEmail}</td>
                  <td style={{ padding: 8 }}>{log.actorRole}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>{log.customerId}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 16, color: '#94a3b8' }}>접근 기록이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 24 }}>
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