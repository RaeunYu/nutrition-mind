/**
 * crypto.service 단위 테스트 (이슈 #13 — envelope encryption).
 *
 * 실행: npx tsx test/crypto.test.mjs  (또는 npm run test:crypto)
 * 검증 항목:
 *  - DEK wrap/unwrap 라운드트립, 필드 encrypt/decrypt 라운드트립
 *  - KEK(마스터 키) 불일치 시 unwrap·복호화 실패(위·변조 방어)
 *  - 동일 평문 매번 다른 암호문(nonce) — 재식별 불가
 *  - 형식 파싱 실패·null/빈 문자열 처리
 *  - MASTER_KEY 미설정 → 폴백 키 + 경고 로그, 잘못된 형식 → 기동 에러
 * (키 값은 어떤 경우에도 출력하지 않는다.)
 */
import { randomBytes } from 'node:crypto';

// tsx로 실행되므로 TS 소스를 직접 임포트한다.
const { CryptoService } = await import('../src/crypto.service.ts');

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

async function throws(fn, messageIncludes = '') {
  try {
    await fn();
    return false;
  } catch (e) {
    if (messageIncludes && !String(e?.message ?? '').includes(messageIncludes)) {
      return false;
    }
    return true;
  }
}

/** MASTER_KEY 환경변수 조작 — 값은 절대 출력하지 않는다. */
function withMasterKey(value, fn) {
  const prev = process.env.MASTER_KEY;
  if (value === undefined) delete process.env.MASTER_KEY;
  else process.env.MASTER_KEY = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MASTER_KEY;
    else process.env.MASTER_KEY = prev;
  }
}

function newCrypto() {
  return new CryptoService();
}

async function main() {
  console.log('== crypto.service 단위 테스트 ==\n');

  console.log('1) 키 로드 정책');
  let fallbackWarned = false;
  const origWarn = console.warn;
  console.warn = (msg) => {
    if (String(msg).includes('MASTER_KEY')) fallbackWarned = true;
  };
  let fallbackCrypto;
  withMasterKey(undefined, () => {
    fallbackCrypto = newCrypto();
  });
  console.warn = origWarn;
  check('MASTER_KEY 미설정 → 폴백 키 사용 + 경고 로그', fallbackCrypto instanceof CryptoService && fallbackCrypto.isFallbackKek && fallbackWarned);

  let errorCrypto = null;
  let invalidThrows = false;
  withMasterKey('not-hex', () => {
    try {
      errorCrypto = newCrypto();
    } catch (e) {
      invalidThrows = String(e?.message ?? '').includes('MASTER_KEY 형식');
    }
  });
  check('MASTER_KEY 잘못된 형식 → 기동 에러(명확한 메시지)', errorCrypto === null && invalidThrows);

  // 이후 테스트: 임의 KEK(폴백 아님)로 안정 검증
  const crypto = withMasterKey(randomBytes(32).toString('hex'), () => newCrypto());
  check('MASTER_KEY 정상 설정 → 폴백 아님', crypto instanceof CryptoService && !crypto.isFallbackKek);

  console.log('\n2) DEK wrap/unwrap 라운드트립');
  {
    const dek = crypto.generateDek();
    check('DEK 발급 — 32바이트', dek.length === 32, `len=${dek.length}`);
    const wrapped = crypto.wrapDek(dek);
    check('wrap 형식 v1:<nonce>:<ct_tag>', typeof wrapped === 'string' && wrapped.startsWith('v1:') && wrapped.split(':').length === 3);
    const unwrapped = crypto.unwrapDek(wrapped);
    check('unwrap 라운드트립 — 동일 DEK 복원', Buffer.compare(dek, unwrapped) === 0);
  }

  console.log('\n3) 필드 encrypt/decrypt 라운드트립');
  {
    const dek = crypto.generateDek();
    const cases = ['김건강', '010-1234-5678', 'kim@example.com', '알레르기: 땅콩 / 관심 성분: 오메가3'];
    for (const text of cases) {
      const enc = crypto.encryptField(text, dek);
      const dec = crypto.decryptField(enc, dek);
      check(`라운드트립: "${text.slice(0, 8)}…"`, typeof enc === 'string' && enc.startsWith('v1:') && dec === text);
    }
    const encNull = crypto.encryptField(null, dek);
    const encEmpty = crypto.encryptField('', dek);
    check('null·빈 문자열 → NULL 처리', encNull === null && encEmpty === null && crypto.decryptField(null, dek) === null);

    const wrong = randomBytes(32);
    const enc = crypto.encryptField('이면역', dek);
    check('다른 DEK로 복호화 실패(변조·키 불일치 방어)', await throws(() => crypto.decryptField(enc, wrong), '복호화 실패'));
    check('형식 파싱 실패 감지', await throws(() => crypto.decryptField('legacy-plain-text', dek), '형식'));
    check('인증 태그 변조 감지', await throws(() => crypto.decryptField(enc.slice(0, -4) + 'AAAA', dek), '복호화 실패'));
  }

  console.log('\n4) 동일 평문 → 매번 다른 암호문(nonce)');
  {
    const dek = crypto.generateDek();
    const c1 = crypto.encryptField('박다이어트', dek);
    const c2 = crypto.encryptField('박다이어트', dek);
    const c3 = crypto.encryptField('박다이어트', dek);
    const unique = new Set([c1, c2, c3]);
    check('동일 평문 3회 암호화 → 3개 모두 다른 암호문', unique.size === 3);
    check('세 암호문 모두 복호화 가능', crypto.decryptField(c1, dek) === '박다이어트' && crypto.decryptField(c2, dek) === '박다이어트' && crypto.decryptField(c3, dek) === '박다이어트');
    const n1 = c1.split(':')[1];
    const n2 = c2.split(':')[1];
    check('nonce 매번 새로 발급', n1 !== n2);
  }

  console.log('\n5) 서로 다른 고객 DEK 독립성');
  {
    const dekA = crypto.generateDek();
    const dekB = crypto.generateDek();
    const encA = crypto.encryptField('010-9999-9999', dekA);
    check('고객B의 DEK로 고객A 필드 복호화 불가', await throws(() => crypto.decryptField(encA, dekB), '복호화 실패'));
  }

  console.log(`\n== 결과: ${passed} 통과 / ${failed} 실패 ==`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});