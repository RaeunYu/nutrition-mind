import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/**
 * 고객 개인식별 필드 envelope encryption 서비스 (ADR-0002, 이슈 #13).
 *
 * 2계층 키 구조:
 *   - KEK(마스터 키): `.env`의 `MASTER_KEY`(32바이트 hex, 64자) — 사용자가 관리한다.
 *     값은 절대 로그에 출력하지 않는다.
 *   - DEK(고객별 데이터 키): 고객마다 1개 발급(무작위 32바이트), KEK로 AES-256-GCM wrap 후
 *     `customers.key_slot`에 저장한다.
 *   - 필드(name·phone·email·memo)는 DEK로 AES-256-GCM 암호화해 `*_enc` 칼럼에 저장한다.
 *
 * 저장 형식(버전 접두): `v1:<nonce_b64>:<ciphertext+tag_b64>`
 *   - nonce는 매번 새로 발급되므로 동일 평문도 암호문이 다르다(재식별 불가).
 *   - 암호문은 nonce마다 달라지므로 DB UNIQUE·정렬·검색은 DB가 담당하지 않고
 *     서비스 레이어(복호화 비교)가 담당한다.
 *
 * KEK 정책:
 *   - `MASTER_KEY`가 설정돼 있으면 32바이트 hex 형식을 검증한다(불일치 시 기동 에러).
 *   - 설정돼 있지 않으면 데모용 폴백 키를 쓰되, 기동 시 경고 로그를 남긴다
 *     (실제 키는 사용자가 `.env`의 `MASTER_KEY`에 채운다 — README 참고).
 */
@Injectable()
export class CryptoService {
  private readonly kek: Buffer;
  private readonly usingFallbackKek: boolean;

  constructor() {
    const raw = process.env.MASTER_KEY ?? '';
    if (raw.length === 0) {
      // 데모 폴백 키 — 고정 솔트에서 유도(재기동 시 동일 키 → 기존 데이터 유지).
      this.usingFallbackKek = true;
      this.kek = createHash('sha256')
        .update('nutrition-mind demo fallback master key (set MASTER_KEY in .env)')
        .digest();
      console.warn(
        '[crypto] MASTER_KEY가 설정되지 않아 데모용 폴백 키를 사용합니다. ' +
          '실제 운영/데모 배포 전 .env의 MASTER_KEY(32바이트 hex, 64자)를 채우세요 — README의 개인정보 암호화 절차 참고.',
      );
    } else if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
      throw new Error(
        '[crypto] MASTER_KEY 형식이 올바르지 않습니다. 32바이트(64자 hex)로 설정하세요. ' +
          '생성 예: openssl rand -hex 32',
      );
    } else {
      this.usingFallbackKek = false;
      this.kek = Buffer.from(raw, 'hex');
    }
  }

  /** 폴백 KEK 사용 여부(README/운영 점검용). */
  get isFallbackKek(): boolean {
    return this.usingFallbackKek;
  }

  /** 고객별 데이터 키(DEK) 발급 — 무작위 32바이트. */
  generateDek(): Buffer {
    return randomBytes(32);
  }

  /**
   * DEK를 KEK로 wrap(AES-256-GCM) → `v1:<nonce_b64>:<ciphertext+tag_b64>`.
   * 저장 위치: customers.key_slot.
   */
  wrapDek(dek: Buffer): string {
    return this.seal(dek, this.kek);
  }

  /** key_slot 값을 KEK로 unwrap해 DEK를 복원. KEK 불일치·변조 시 예외. */
  unwrapDek(wrapped: string): Buffer {
    return this.open(wrapped, this.kek, 'DEK unwrap 실패(KEK 불일치 또는 key_slot 변조)');
  }

  /**
   * 필드 평문을 DEK로 암호화 → `v1:<nonce_b64>:<ciphertext+tag_b64>`.
   * null/빈 문자열은 null(칼럼 NULL)로 처리한다.
   */
  encryptField(plaintext: string | null | undefined, dek: Buffer): string | null {
    if (plaintext === null || plaintext === undefined) return null;
    if (plaintext.length === 0) return null;
    return this.seal(Buffer.from(plaintext, 'utf8'), dek);
  }

  /** 필드 암호문을 DEK로 복호화. null 입력은 null 반환, 형식·인증 실패는 예외. */
  decryptField(encrypted: string | null | undefined, dek: Buffer): string | null {
    if (encrypted === null || encrypted === undefined || encrypted.length === 0) return null;
    const plain = this.open(encrypted, dek, '고객 필드 복호화 실패(DEK 불일치 또는 데이터 변조)');
    return plain.toString('utf8');
  }

  /** AES-256-GCM 봉인 — 출력: v1:<nonce_b64>:<ciphertext+tag_b64>. */
  private seal(plaintext: Buffer, key: Buffer): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    return `v1:${nonce.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  /** AES-256-GCM 개봉 — 형식/버전/인증 태그 검증 실패 시 예외. */
  private open(envelope: string, key: Buffer, failureMessage: string): Buffer {
    const parts = envelope.split(':');
    if (parts.length !== 3 || parts[0] !== 'v1') {
      throw new Error(`${failureMessage}: 지원하지 않는 암호문 형식(v1:nonce:ciphertext 기대)`);
    }
    let nonce: Buffer;
    let ciphertextWithTag: Buffer;
    try {
      nonce = Buffer.from(parts[1], 'base64');
      ciphertextWithTag = Buffer.from(parts[2], 'base64');
    } catch {
      throw new Error(`${failureMessage}: base64 디코드 실패`);
    }
    if (nonce.length !== 12 || ciphertextWithTag.length < 16) {
      throw new Error(`${failureMessage}: 암호문 길이 이상`);
    }
    const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
    const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new Error(failureMessage);
    }
  }
}