'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import WorkspaceHeader from '../../_components/workspace-header';
import Spinner from '../../_components/spinner';
import { BACKEND, getAuth, type Auth } from '../../../lib/auth';
import { colors, pageContainer, btnPrimary, btnSecondary } from '../../../lib/design';

const inputStyle: React.CSSProperties = { display: 'block', width: '100%', padding: 10, marginBottom: 8, boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { padding: '8px 14px', cursor: 'pointer' };

interface CustomerDetail {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  memo: string | null;
  ingredients: string[];
  interests: InterestItem[];
  intakeProducts: IntakeProduct[];
}

/** 성분 마스터 (이슈 #16) — GET /ingredients. */
interface IngredientMaster {
  id: string;
  name: string;
  synonyms: string | null;
  keywords: string | null;
}

interface InterestItem {
  ingredientId: string;
  name: string;
}

/** 매핑 근거 — 어떤 키워드가 어느 원료 텍스트에서 매칭됐는지(수동 성분은 source 라벨로 구분). */
interface GapEvidence {
  productName: string | null;
  matchedKeyword: string;
  rawMaterialText: string;
  source: 'intake_product' | 'manual_ingredient';
}

interface GapInterest {
  ingredientId: string;
  name: string;
  covered: boolean;
  evidence: GapEvidence[];
}

/** 성분 갭 응답 (이슈 #16) — GET /customers/:id/gap. */
interface GapResponse {
  interests: GapInterest[];
  gap: { ingredientId: string; name: string }[];
  unmappedMaterials: { productName: string | null; rawMaterialText: string }[];
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

interface RecommendationItem {
  id: string;
  ingredientName: string;
  apiCode: string | null;
  productName: string;
  manufacturerName: string | null;
  productionEnded: string | null;
  reportNo: string | null;
  evidenceKeyword: string;
  evidenceRawMaterial: string;
  status: string;
}

interface SearchResult {
  productName: string;
  rawMaterialName: string | null;
  functionalityText: string | null;
  reportNo: string | null;
  apiCode: string;
}

/**
 * 고객 상세 — 영업·상담 담당자용 (이슈 #13·#15·#16).
 * 상단: 개인식별 필드 복호화 표시·수정(ADR-0002, 접근 기록은 #14).
 * 중단: 관심 성분 지정(성분 마스터 선택) + 성분 갭 카드(커버 근거·미커버 목록·매핑 실패 원료) — 이슈 #16.
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
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [recommendationMessage, setRecommendationMessage] = useState('');
  const [recommendationBusy, setRecommendationBusy] = useState(false);

  // 관심 성분·성분 갭 (이슈 #16)
  const [master, setMaster] = useState<IngredientMaster[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [gap, setGap] = useState<GapResponse | null>(null);
  const [interestMessage, setInterestMessage] = useState('');
  const [interestBusy, setInterestBusy] = useState(false);

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
      const recRes = await fetch(`${BACKEND}/customers/${params.id}/recommendations`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (recRes.ok) {
        const recData = await recRes.json();
        setRecommendations(Array.isArray(recData) ? recData : recData.items ?? []);
      }
      setSelected((data.interests ?? []).map((i) => i.ingredientId)); // 저장된 관심 성분 기준(재로드 시 갱신)
      setError('');
    } catch (e) {
      setError('상세 조회 실패: ' + String(e));
    }
  }, [auth, params?.id]);

  useEffect(() => { void reload(); }, [reload]);

  // 성분 마스터 목록(관심 성분 선택 UI 소스) — 이슈 #16
  const loadMaster = useCallback(async () => {
    if (!auth) return;
    try {
      const res = await fetch(`${BACKEND}/ingredients`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (res.ok) setMaster(await res.json());
    } catch {
      setMaster([]);
    }
  }, [auth]);
  useEffect(() => { void loadMaster(); }, [loadMaster]);

  // 성분 갭 조회(이슈 #16) — 관심 성분 변경·섭취 제품 변경 후 재조회
  const loadGap = useCallback(async () => {
    if (!auth || !params?.id) return;
    try {
      const res = await fetch(`${BACKEND}/customers/${params.id}/gap`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      setGap(res.ok ? await res.json() : null);
    } catch {
      setGap(null);
    }
  }, [auth, params?.id]);
  useEffect(() => { void loadGap(); }, [loadGap]);

  function toggleInterest(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function saveInterests() {
    if (!auth || !params?.id) return;
    setInterestBusy(true); setInterestMessage('');
    try {
      const res = await fetch(`${BACKEND}/customers/${params.id}/interests`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify({ ingredientIds: selected }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInterestMessage(data?.message ?? '저장 실패');
      } else {
        setInterestMessage(`저장 완료 — 관심 성분 ${data.interests?.length ?? 0}개`);
        await loadGap(); // 관심 성분 변경 직후 갭 카드 갱신
      }
    } catch (e) {
      setInterestMessage('저장 실패: ' + String(e));
    } finally { setInterestBusy(false); }
  }

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
        await loadGap();
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
        await loadGap();
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
        await loadGap();
      } else {
        setIntakeMessage('제거 실패');
      }
    } catch (e) {
      setIntakeMessage('제거 실패: ' + String(e));
    } finally { setIntakeBusy(false); }
  }

  async function generateRecommendations() {
    if (!auth || !params?.id) return;
    setRecommendationBusy(true); setRecommendationMessage('');
    try {
      const res = await fetch(`${BACKEND}/customers/${params.id}/recommendations/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setRecommendationMessage(data?.message ?? '추천 생성 실패');
      } else {
        setRecommendationMessage(`추천 ${data.created}건 생성`);
        await reload();
      }
    } catch (e) {
      setRecommendationMessage('추천 생성 실패: ' + String(e));
    } finally { setRecommendationBusy(false); }
  }

  async function decide(rid: string, status: 'accepted' | 'held') {
    if (!auth || !params?.id) return;
    setRecommendationBusy(true); setRecommendationMessage('');
    try {
      const res = await fetch(`${BACKEND}/customers/${params.id}/recommendations/${rid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setRecommendationMessage('상태 변경 완료');
        await reload();
      } else {
        setRecommendationMessage('상태 변경 실패');
      }
    } catch (e) {
      setRecommendationMessage('상태 변경 실패: ' + String(e));
    } finally { setRecommendationBusy(false); }
  }

  if (!auth) {
    return <main style={{ padding: 40, color: '#64748b' }}>인증 확인 중…</main>;
  }

  return (
    <div>
      <WorkspaceHeader title="고객 상세" auth={auth} />
      <main style={pageContainer}>
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

            <section style={{ marginBottom: 24, border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>⭐ 관심 성분 — 성분 마스터에서 선택 (이슈 #16)</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {master.map((ing) => (
                  <label key={ing.id} style={{ fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={selected.includes(ing.id)} onChange={() => toggleInterest(ing.id)} />
                    {' '}{ing.name}
                    {ing.synonyms && <span style={{ color: '#94a3b8', fontSize: 11 }}> ({ing.synonyms})</span>}
                  </label>
                ))}
                {master.length === 0 && <span style={{ color: '#94a3b8', fontSize: 13 }}>성분 마스터가 비어 있습니다.</span>}
              </div>
              <button onClick={() => { void saveInterests(); }} disabled={interestBusy} style={{ marginTop: 10, ...btnPrimary, fontSize: 13 }}>
                {interestBusy ? '저장 중…' : `관심 성분 저장 (${selected.length}개 선택)`}
              </button>
              {interestMessage && <p style={{ color: '#334155', fontSize: 13 }}>{interestMessage}</p>}
            </section>

            <section style={{ marginBottom: 24, border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>🧭 성분 갭 — 관심 성분 커버리지 (이슈 #16)</h2>
              {gap && (
                <>
                  <p style={{ margin: '4px 0', fontSize: 13, color: '#475569' }}>
                    관심 성분 {gap.interests.length}개 중 커버 {gap.interests.filter((i) => i.covered).length}개 · 미커버(갭) {gap.gap.length}개
                  </p>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {gap.interests.map((i) => (
                      <li key={i.ingredientId} style={{ padding: 8, borderBottom: '1px solid #f1f5f9' }}>
                        <strong style={{ fontSize: 13 }}>{i.name}</strong>{' '}
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 999,
                          background: i.covered ? '#dcfce7' : '#fee2e2', color: '#1e293b',
                        }}>
                          {i.covered ? '커버됨' : '미커버(갭)'}
                        </span>
                        {i.covered && (
                          <div style={{ marginTop: 4, fontSize: 12, color: '#475569' }}>
                            {i.evidence.map((e, idx) => (
                              <div key={idx}>
                                {e.source === 'manual_ingredient'
                                  ? `수동 성분: ${e.rawMaterialText} — 키워드「${e.matchedKeyword}」`
                                  : `${e.productName} — 키워드「${e.matchedKeyword}」(원료: ${e.rawMaterialText.slice(0, 80)}${e.rawMaterialText.length > 80 ? '…' : ''})`}
                              </div>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                    {gap.interests.length === 0 && <li style={{ color: '#94a3b8', fontSize: 13 }}>관심 성분을 먼저 지정하세요.</li>}
                  </ul>
                  {gap.unmappedMaterials.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <p style={{ margin: '4px 0', fontSize: 13, fontWeight: 600 }}>
                        매핑 실패 원료 ({gap.unmappedMaterials.length}건) — 성분 마스터 키워드 규칙에 해당 없음
                      </p>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#475569' }}>
                        {gap.unmappedMaterials.map((m, idx) => (
                          <li key={idx}>{m.productName}: {m.rawMaterialText.slice(0, 100)}{m.rawMaterialText.length > 100 ? '…' : ''}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
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
                    <button onClick={() => { void removeIntake(p.id); }} disabled={intakeBusy} style={{ ...btnSecondary, marginTop: 8, fontSize: 12 }}>
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
                <button onClick={() => { void searchProducts(); }} disabled={intakeBusy} style={{ ...btnSecondary, display: 'inline-flex', alignItems: 'center' }}>
                {intakeBusy && <Spinner size={12} color={colors.ink} />}검색
              </button>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: 15, margin: 0 }}>💡 성분 갭 기반 추천 제안</h2>
                <button onClick={() => { void generateRecommendations(); }} disabled={recommendationBusy}
                  style={{ padding: '6px 12px', cursor: 'pointer', borderRadius: 6, fontSize: 13 }}>
                  추천 생성
                </button>
              </div>
              <p style={{ fontSize: 12, color: '#64748b' }}>
                성분 갭(미커버 관심 성분)을 제공하는 품목제조신고 제품을 근거와 함께 제안합니다 — 담당자가 수용·보류로 확인하세요.
              </p>
              {recommendationMessage && <p style={{ color: '#334155', fontSize: 13 }}>{recommendationMessage}</p>}
              {recommendations.map((r) => (
                <div key={r.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 13 }}>{r.productName}</strong>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 999,
                      background: r.status === 'accepted' ? '#dcfce7' : r.status === 'held' ? '#fef3c7' : '#e0e7ff',
                      color: '#1e293b',
                    }}>
                      {r.status === 'accepted' ? '수용' : r.status === 'held' ? '보류' : '제안됨'}
                    </span>
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#475569' }}>
                    근거: 관심 성분 <strong>{r.ingredientName}</strong> 을 키워드 "{r.evidenceKeyword}" 로 커버
                  </p>
                  <div style={{ margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{r.apiCode} · {r.reportNo}</span>
                    {r.productionEnded === '예' && (
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: '#fee2e2', color: '#991b1b', fontWeight: 700 }}>
                        생산종료
                      </span>
                    )}
                  </div>
                  {r.manufacturerName && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#475569' }}>업소명: {r.manufacturerName}</p>}
                  {r.status === 'proposed' && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                      <button onClick={() => { void decide(r.id, 'accepted'); }} disabled={recommendationBusy} style={{ ...btnPrimary, fontSize: 12, padding: '4px 10px' }}>수용</button>
                      <button onClick={() => { void decide(r.id, 'held'); }} disabled={recommendationBusy} style={{ ...btnSecondary, fontSize: 12, padding: '4px 10px' }}>보류</button>
                    </div>
                  )}
                </div>
              ))}
              {recommendations.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>추천 제안이 없습니다 — "추천 생성"을 눌러보세요.</p>}
            </section>

            <section style={{ marginBottom: 24, border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>수동 등록(식약처 미수록 제품)</h2>
              <input style={inputStyle} placeholder="제품명 (필수)" value={manual.productName}
                onChange={(e) => setManual({ ...manual, productName: e.target.value })} />
              <input style={inputStyle} placeholder="원료 (선택)" value={manual.rawMaterials}
                onChange={(e) => setManual({ ...manual, rawMaterials: e.target.value })} />
              <input style={inputStyle} placeholder="기능성·주의사항 (선택)" value={manual.functionality}
                onChange={(e) => setManual({ ...manual, functionality: e.target.value })} />
              <button onClick={() => { void registerManual(); }} disabled={intakeBusy} style={{ ...btnPrimary, fontSize: 13 }}>수동 등록</button>
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
              <button onClick={save} disabled={busy} style={btnPrimary}>
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