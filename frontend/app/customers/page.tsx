'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import WorkspaceHeader from '../_components/workspace-header';
import { BACKEND, getAuth, type Auth } from '../../lib/auth';

const inputStyle: React.CSSProperties = { display: 'block', width: '100%', padding: 10, marginBottom: 8, boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { padding: '8px 14px', cursor: 'pointer' };

interface CustomerListItem {
  id: string;
  name: string;   // 마스킹 (예: 김**)
  phone: string | null;
  email: string | null;
  ingredients: string[];
}

/**
 * 고객 목록 — 영업·상담 담당자용 (이슈 #13).
 * 개인식별 필드는 마스킹 값만 노출(최소노출 원칙, ADR-0002).
 * 전체 값은 상세 화면에서만 확인하며, 상세 접근 기록은 이슈 #14에서 추가.
 */
export default function CustomersPage() {
  const router = useRouter();
  const [auth, setAuth] = useState<Auth | null>(null);
  const [items, setItems] = useState<CustomerListItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', memo: '' });
  const [formMessage, setFormMessage] = useState('');

  useEffect(() => {
    const a = getAuth();
    if (!a) { router.replace('/login'); return; }
    if (a.role === 'marketing') { router.replace('/marketing'); return; }
    setAuth(a);
  }, [router]);

  const reload = useCallback(async () => {
    if (!auth) return;
    try {
      const res = await fetch(`${BACKEND}/customers`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (res.status === 403) { setError('접근 권한이 없습니다.'); return; }
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setError('목록 조회 실패: ' + String(e));
    }
  }, [auth]);

  useEffect(() => { void reload(); }, [reload]);

  async function register() {
    if (!auth) return;
    if (!form.name.trim()) { setFormMessage('이름은 필수입니다.'); return; }
    setBusy(true); setFormMessage('');
    try {
      const res = await fetch(`${BACKEND}/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormMessage(data?.message?.[0] ?? data?.message ?? '등록 실패');
      } else {
        setFormMessage(`등록 완료 (${data.name})`);
        setForm({ name: '', phone: '', email: '', memo: '' });
        await reload();
      }
    } catch (e) {
      setFormMessage('등록 실패: ' + String(e));
    } finally { setBusy(false); }
  }

  if (!auth) {
    return <main style={{ padding: 40, color: '#64748b' }}>인증 확인 중…</main>;
  }

  return (
    <div>
      <WorkspaceHeader title="고객 관리" auth={auth} />
      <main style={{ maxWidth: 760, margin: '24px auto', padding: 24, background: '#fff', borderRadius: 12 }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>👥 고객 목록</h1>
        <p style={{ color: '#666', fontSize: 13 }}>
          개인정보는 목록에서 마스킹됩니다(최소노출). 전체 값은 상세 화면에서만 확인하세요.
        </p>
        <Link href="/" style={{ fontSize: 13, color: '#1d4ed8' }}>← 상담 워크스페이스로</Link>

        {error && <p style={{ color: '#dc2626' }}>{error}</p>}

        <section style={{ marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: 8 }}>이름</th>
                <th style={{ padding: 8 }}>연락처</th>
                <th style={{ padding: 8 }}>이메일</th>
                <th style={{ padding: 8 }}>성분</th>
                <th style={{ padding: 8 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: 8 }}>{c.name}</td>
                  <td style={{ padding: 8 }}>{c.phone ?? '—'}</td>
                  <td style={{ padding: 8 }}>{c.email ?? '—'}</td>
                  <td style={{ padding: 8 }}>{c.ingredients.join(', ') || '—'}</td>
                  <td style={{ padding: 8 }}>
                    <Link href={`/customers/${c.id}`} style={{ color: '#1d4ed8', fontSize: 13 }}>상세</Link>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 16, color: '#94a3b8' }}>고객이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>고객 등록</h2>
          <input style={inputStyle} placeholder="이름 (필수)" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input style={inputStyle} placeholder="연락처 (예: 010-1234-5678)" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input style={inputStyle} placeholder="이메일 (선택)" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <textarea style={inputStyle} placeholder="메모 (선택)" rows={2} value={form.memo}
            onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          <button onClick={register} disabled={busy} style={btnStyle}>
            {busy ? '등록 중…' : '고객 등록'}
          </button>
          {formMessage && <p style={{ color: '#334155', fontSize: 13 }}>{formMessage}</p>}
          <p style={{ color: '#94a3b8', fontSize: 12 }}>
            입력값은 envelope encryption으로 암호화 저장됩니다(평문 저장 없음 — ADR-0002).
          </p>
        </section>
      </main>
    </div>
  );
}