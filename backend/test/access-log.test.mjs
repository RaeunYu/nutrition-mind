/**
 * 접근 로그 통합 테스트 (이슈 #14 — ADR-0002).
 *
 * 사전 조건: backend(3001) 구동 중 + 고객 시딩(18명 이상).
 * 실행: node test/access-log.test.mjs   (또는 npm run test:access-log)
 * 검증 항목:
 *  - 상담 담당자의 고객 상세 접근 → 접근 로그 기록(담당자·역할·고객 ID)
 *  - 열람은 총관리자 전용: 상담·마케팅 403 / 미인증 401
 *  - limit 파라미터 동작
 */
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: resolve(process.cwd(), '..', '.env') });

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const CONSULTANT = { email: 'consultant@example.com', password: 'consult1234' };
const MARKETING = { email: 'marketing@example.com', password: 'marketing1234' };
const ADMIN = { email: 'admin@example.com', password: 'admin1234' };

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ PASS ${name}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return body.accessToken;
}

async function api(method, path, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const parsed = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

async function main() {
  console.log(`== 접근 로그 통합 테스트 (${BASE}) ==\n`);

  const consultant = await login(CONSULTANT.email, CONSULTANT.password);
  const marketing = await login(MARKETING.email, MARKETING.password);
  const admin = await login(ADMIN.email, ADMIN.password);
  check('담당자 3계정 로그인', typeof consultant === 'string' && typeof marketing === 'string' && typeof admin === 'string');

  console.log('\n1) 접근 기록 생성');
  {
    const list = await api('GET', '/customers', consultant);
    const customerId = list.body?.[0]?.id;
    check('고객 목록 조회(테스트 대상 확보)', Boolean(customerId), `id=${customerId}`);
    // 로그 누적 시 API 페이지(최신 200건)만으로는 증가 판정이 흔들리므로 DB 카운트로 검증한다
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const countLogs = async () => {
      const r = await pool.query('SELECT COUNT(*)::int AS n FROM access_logs WHERE actor_email = $1 AND customer_id = $2', [CONSULTANT.email, customerId]);
      return r.rows[0].n;
    };
    const before = await countLogs();

    await api('GET', `/customers/${customerId}`, consultant);
    const after = await countLogs();
    check('상세 접근 후 로그 증가(DB 카운트)', after > before, `before=${before} after=${after}`);
    const logList = await api('GET', '/admin/access-logs?limit=50', admin);
    const newest = (logList.body?.items ?? [])[0];
    check('기록 내용(담당자·역할·고객) 일치', Boolean(newest) && newest.actorEmail === CONSULTANT.email && newest.actorRole === 'consultant', JSON.stringify(newest ?? null));
    await pool.end();
  }

  console.log('\n2) 열람 권한(총관리자 전용)');
  {
    const noAuth = await api('GET', '/admin/access-logs', null);
    check('미인증 → 401', noAuth.status === 401, `status=${noAuth.status}`);
    const asConsultant = await api('GET', '/admin/access-logs', consultant);
    check('상담 담당자 → 403', asConsultant.status === 403, `status=${asConsultant.status}`);
    const asMarketing = await api('GET', '/admin/access-logs', marketing);
    check('마케팅 담당자 → 403', asMarketing.status === 403, `status=${asMarketing.status}`);
  }

  console.log('\n3) 조회 파라미터');
  {
    const limited = await api('GET', '/admin/access-logs?limit=1', admin);
    check('limit=1 → 1건', limited.body?.items?.length === 1, `items=${limited.body?.items?.length}`);
  }

  console.log(`\n== 결과: ${passed} 통과 / ${failed} 실패 ==`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('테스트 실행 실패:', e);
  process.exit(1);
});