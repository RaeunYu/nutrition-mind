'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import WorkspaceHeader from '../../_components/workspace-header';
import { BACKEND, getAuth, type Auth } from '../../../lib/auth';

const inputStyle: React.CSSProperties = { display: 'block', width: '100%', padding: 10, marginBottom: 8, boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { padding: '8px 14px', cursor: 'pointer' };

interface CustomerDetail {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  memo: string | null;
  ingredients: string[];
}

/**
 * 고객 상세 — 영업·상담 담당자용 (이슈 #13).
 * 상세 조회 시에만 개인식별 필드가 복호화되어 표시된다(ADR-0002).
 * 이 화면에 대한 접근 기록은 이슈 #14에서 추가된다.
 */
export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [auth, setAuth] = useState<Auth | null>(null);
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState({ name: '', phone: '', email: '', memo: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const a = getAuth();
    if (!a) { router.replace('/login'); return; }
    if (a.role === 'marketing') { router.replace('/marketing'); return; }
    setAuth(a);
  }, [router]);

  const reload = useCallback(async () => {
    if (!auth || !params?.id) return;
    try {
      const res = await fetch(`${BACKEND}/customers/${params.id}`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? '조회 실패');
        return;
      }
      const data: CustomerDetail = await res.json();
      setCustomer(data);
      setEdit({ name: data.name ?? '', phone: data.phone ?? '', email: data.email ?? '', memo: data.memo ?? '' });
    } catch (e) {
      setError('상세 조회 실패: ' + String(e));
    }
  }, [auth, params?.id]);

  useEffect(() => { void reload(); }, [reload]);

  async function save() {
    if (!auth || !params?.id) return;
    setBusy(true); setMessage('');
    try {
      const body: Record<string, string | null> = {};
      if (edit.name !== (customer?.name ?? '')) body.name = edit.name || null;
      if (edit.phone !== (customer?.phone ?? '')) body.phone = edit.phone || null;
      if (edit.email !== (customer?.email ?? '')) body.email = edit.email || null;
      if (edit.memo !== (customer?.memo ?? '')) body.memo = edit.memo || null;
      const res = await fetch(`${BACKEND}/customers/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data?.message?.[0] ?? data?.message ?? '수정 실패');
      } else {
        setMessage('수정 완료');
        await reload();
      }
    } catch (e) {
      setMessage('수정 실패: ' + String(e));
    } finally { setBusy(false); }
  }

  if (!auth) {
    return <main style={{ padding: 40, color: '#64748b' }}>인증 확인 중…</main>;
  }

  return (
    <div>
      <WorkspaceHeader title="고객 상세" auth={auth} />
      <main style={{ maxWidth: 640, margin: '24px auto', padding: 24, background: '#fff', borderRadius: 12 }}>
        <Link href="/customers" style={{ fontSize: 13, color: '#1d4ed8' }}>← 고객 목록으로</Link>
        <h1 style={{ fontSize: 20, marginTop: 12 }}>👤 고객 상세</h1>
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
        {customer && (
          <>
            <section style={{ background: '#f8fafc', padding: 16, borderRadius: 8, marginBottom: 20 }}>
              <p style={{ margin: '4px 0' }}><strong>이름:</strong> {customer.name ?? '—'}</p>
              <p style={{ margin: '4px 0' }}><strong>연락처:</strong> {customer.phone ?? '—'}</p>
              <p style={{ margin: '4px 0' }}><strong>이메일:</strong> {customer.email ?? '—'}</p>
              <p style={{ margin: '4px 0' }}><strong>메모:</strong> {customer.memo ?? '—'}</p>
              <p style={{ margin: '4px 0' }}><strong>성분:</strong> {customer.ingredients.join(', ') || '—'}</p>
            </section>

            <h2 style={{ fontSize: 16, marginTop: 0 }}>고객 정보 수정</h2>
            <input style={inputStyle} placeholder="이름" value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <input style={inputStyle} placeholder="연락처" value={edit.phone}
              onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            <input style={inputStyle} placeholder="이메일" value={edit.email}
              onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
            <textarea style={inputStyle} placeholder="메모" rows={3} value={edit.memo}
              onChange={(e) => setEdit({ ...edit, memo: e.target.value })} />
            <button onClick={save} disabled={busy} style={btnStyle}>
              {busy ? '저장 중…' : '저장'}
            </button>
            {message && <p style={{ color: '#334155', fontSize: 13 }}>{message}</p>}
            <p style={{ color: '#94a3b8', fontSize: 12 }}>
              이 화면은 개인정보가 복호화되어 표시됩니다 — 접근 기록은 총관리자 화면에서 확인됩니다(이슈 #14).
            </p>
          </>
        )}
      </main>
    </div>
  );
}