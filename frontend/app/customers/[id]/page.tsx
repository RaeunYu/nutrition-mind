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
  intakeProducts: IntakeProduct[];
}

interface IntakeProduct {
  id: string;
  source: 'foodsafety' | 'manual';
  apiCode: string | null;
  reportNo: string | null;
  productName: string;
  rawMaterials: string | null;
  functionality: string | null;
}

interface SearchResult {
  productName: string;
  rawMaterialName: string | null;
  functionalityText: string | null;
  reportNo: string | null;
  apiCode: string;
}

/**
 * 고객 상세 — 영업·상담 담당자용 (이슈 #13·#15).
 * 상단: 개인식별 필드 복호화 표시·수정(ADR-0002, 접근 기록은 #14).
 * 하단: 섭취 제품 관리 — 품목제조신고 검색 연결 또는 수동 등록(이슈 #15).
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

  // 섭취 제품
  const [intakes, setIntakes] = useState<IntakeProduct[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [manual, setManual] = useState({ productName: '', rawMaterials: '', functionality: '' });
  const [intakeMessage, setIntakeMessage] = useState('');
  const [intakeBusy, setIntakeBusy] = useState(false);

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
      setIntakes(data.intakeProducts ?? []);
      setError('');
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

  async function searchProducts() {
    if (!auth) return;
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    setIntakeBusy(true);
    try {
      const qs = new URLSearchParams({ query: searchQuery.trim(), field: 'product', limit: '5' });
      const res = await fetch(`${BACKEND}/products/search?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const data = await res.json();
      setSearchResults(data.items ?? []);
    } catch {
      setSearchResults([]);
    } finally { setIntakeBusy(false); }
  }

  async function linkFoodsafety(item: SearchResult) {
    if (!auth || !params?.id) return;
    if (!item.reportNo) { setIntakeMessage('신고번호가 없는 결과는 연결할 수 없습니다(수동 등록을 사용하세요).'); return; }
    setIntakeBusy(true); setIntakeMessage('');
    try {
      const res = await fetch(`${BACKEND}/customers/${params.id}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify({ source: 'foodsafety', apiCode: item.apiCode, reportNo: item.reportNo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIntakeMessage(data?.message ?? '연결 실패');
      } else {
        setIntakeMessage(`연결 완료: ${data.productName}`);
        await reload();
      }
    } catch (e) {
      setIntakeMessage('연결 실패: ' + String(e));
    } finally { setIntakeBusy(false); }
  }

  async function registerManual() {
    if (!auth || !params?.id) return;
    if (!manual.productName.trim()) { setIntakeMessage('제품명은 필수입니다.'); return; }
    setIntakeBusy(true); setIntakeMessage('');
    try {
      const res = await fetch(`${BACKEND}/customers/${params.id}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify({ source: 'manual', ...manual }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIntakeMessage(data?.message ?? '등록 실패');
      } else {
        setIntakeMessage(`등록 완료: ${data.productName}`);
        setManual({ productName: '', rawMaterials: '', functionality: '' });
        await reload();
      }
    } catch (e) {
      setIntakeMessage('등록 실패: ' + String(e));
    } finally { setIntakeBusy(false); }
  }

  async function removeIntake(productId: string) {
    if (!auth || !params?.id) return;
    setIntakeBusy(true); setIntakeMessage('');
    try {
      const res = await fetch(`${BACKEND}/customers/${params.id}/products/${productId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (res.ok) {
        setIntakeMessage('제거 완료');
        await reload();
      } else {
        setIntakeMessage('제거 실패');
      }
    } catch (e) {
      setIntakeMessage('제거 실패: ' + String(e));
    } finally { setIntakeBusy(false); }
  }

  if (!auth) {
    return <main style={{ padding: 40, color: '#64748b' }}>인증 확인 중…</main>;
  }

  return (
    <div>
      <WorkspaceHeader title="고객 상세" auth={auth} />
      <main style={{ maxWidth: 720, margin: '24px auto', padding: 24, background: '#fff', borderRadius: 12 }}>
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

            <section style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16 }}>💊 섭취 제품 ({intakes.length}건)</h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {intakes.map((p) => (
                  <li key={p.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>{p.productName}</strong>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 999,
                        background: p.source === 'foodsafety' ? '#dbeafe' : '#fef3c7', color: '#1e293b',
                      }}>
                        {p.source === 'foodsafety' ? '품목제조신고' : '수동 등록'}
                      </span>
                    </div>
                    {p.rawMaterials && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#475569' }}>원료: {p.rawMaterials.slice(0, 120)}{p.rawMaterials.length > 120 ? '…' : ''}</p>}
                    {p.functionality && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#475569' }}>기능성: {p.functionality.slice(0, 120)}{p.functionality.length > 120 ? '…' : ''}</p>}
                    <button onClick={() => { void removeIntake(p.id); }} disabled={intakeBusy}
                      style={{ marginTop: 8, fontSize: 12, padding: '4px 10px', cursor: 'pointer', borderRadius: 6 }}>
                      제거
                    </button>
                  </li>
                ))}
                {intakes.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>아직 섭취 제품이 없습니다.</p>}
              </ul>
              {intakeMessage && <p style={{ color: '#334155', fontSize: 13 }}>{intakeMessage}</p>}
            </section>

            <section style={{ marginBottom: 24, border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>품목제조신고 제품 검색 → 연결</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...inputStyle, marginBottom: 0 }} placeholder="제품명 검색 (예: 유산균)"
                  value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { void searchProducts(); } }} />
                <button onClick={() => { void searchProducts(); }} disabled={intakeBusy} style={btnStyle}>검색</button>
              </div>
              {searchResults !== null && (
                <div style={{ marginTop: 12 }}>
                  {searchResults.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>검색 결과가 없습니다.</p>}
                  {searchResults.map((item) => (
                    <div key={`${item.apiCode}-${item.reportNo}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: 8, borderBottom: '1px solid #f1f5f9' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{item.productName}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{item.apiCode} · {item.reportNo}</div>
                      </div>
                      <button onClick={() => { void linkFoodsafety(item); }} disabled={intakeBusy}
                        style={{ padding: '4px 10px', cursor: 'pointer', borderRadius: 6, fontSize: 12 }}>
                        연결
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={{ marginBottom: 24, border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>수동 등록(식약처 미수록 제품)</h2>
              <input style={inputStyle} placeholder="제품명 (필수)" value={manual.productName}
                onChange={(e) => setManual({ ...manual, productName: e.target.value })} />
              <input style={inputStyle} placeholder="원료 (선택)" value={manual.rawMaterials}
                onChange={(e) => setManual({ ...manual, rawMaterials: e.target.value })} />
              <input style={inputStyle} placeholder="기능성·주의사항 (선택)" value={manual.functionality}
                onChange={(e) => setManual({ ...manual, functionality: e.target.value })} />
              <button onClick={() => { void registerManual(); }} disabled={intakeBusy} style={btnStyle}>수동 등록</button>
            </section>

            <section style={{ marginBottom: 8 }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>고객 정보 수정</h2>
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
            </section>
          </>
        )}
      </main>
    </div>
  );
}