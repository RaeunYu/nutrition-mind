import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { PrismaService } from './prisma.service';
import { CryptoService } from './crypto.service';

/**
 * 고객 API (ADR-0002, 이슈 #13).
 *
 * 개인식별 필드(name·phone·email·memo)는 envelope encryption으로만 저장된다:
 *   - 고객별 DEK를 KEK로 wrap해 customers.key_slot에, 필드 암호문은 *_enc 칼럼에 저장.
 *   - DB에 평문 개인식별 필드는 존재하지 않는다(검증: test/customers.test.mjs SQL 어서션).
 *
 * 암호문은 nonce마다 달라지므로 DB UNIQUE·정렬·검색이 불가하다:
 *   - 중복검사·이름 정렬은 서비스 레이어(복호화 비교)가 담당한다(데모 규모, n=고객 수).
 *
 * 최소노출 원칙(ADR-0002):
 *   - 목록은 마스킹 값만 반환(이름 첫 글자 + '**', 연락처 뒤 4자리, 이메일 도메인만).
 *   - 평문(복호화)은 상세 조회에만 반환한다.
 *   - 접근 로그 기록은 이슈 #14 범위로 구현하지 않는다.
 *
 * 인가: 영업·상담 담당자 + 운영 확인을 위한 총관리자.
 * 제품기획·마케팅 담당자는 고객 개인정보에 접근하지 않는다(ADR-0002) → 403.
 * 담당자–고객 소유 구조 없음: 상담 담당자는 시스템의 모든 고객을 조회한다(ADR-0002).
 */
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('consultant', 'admin')
export class CustomersController {
  /** 입력 길이 제한(최소수집 원칙 + 악성 입력 방어). */
  private static readonly LIMITS = { name: 100, phone: 30, email: 200, memo: 2000 } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** 고객 목록 — 개인식별 필드 마스킹(이름 첫 글자 + '**', 연락처 뒤 4자리, 이메일 도메인). */
  @Get()
  async list() {
    const rows = await this.prisma.customer.findMany({ include: { ingredients: true } });
    const items = rows
      .map((row) => {
        const dek = this.crypto.unwrapDek(row.keySlot);
        const name = this.crypto.decryptField(row.nameEnc, dek) ?? '';
        const phone = this.crypto.decryptField(row.phoneEnc, dek);
        const email = this.crypto.decryptField(row.emailEnc, dek);
        return {
          id: row.id,
          name: maskName(name),
          phone: maskPhone(phone),
          email: maskEmail(email),
          ingredients: row.ingredients
            .map((ci) => ci.ingredientName)
            .sort((a, b) => a.localeCompare(b, 'ko')),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return items;
  }

  /** 고객 상세 — 개인식별 필드 복호화(상담 담당자 조회 용도). */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const row = await this.prisma.customer.findUnique({
      where: { id },
      include: { ingredients: true },
    });
    if (!row) throw new NotFoundException('고객을 찾을 수 없습니다.');
    const dek = this.crypto.unwrapDek(row.keySlot);
    return {
      id: row.id,
      name: this.crypto.decryptField(row.nameEnc, dek),
      phone: this.crypto.decryptField(row.phoneEnc, dek),
      email: this.crypto.decryptField(row.emailEnc, dek),
      memo: this.crypto.decryptField(row.memoEnc, dek),
      ingredients: row.ingredients
        .map((ci) => ci.ingredientName)
        .sort((a, b) => a.localeCompare(b, 'ko')),
    };
  }

  /** 고객 등록 — 입력을 암호화해 저장. 같은 이름 중복은 복호화 비교로 검사. */
  @Post()
  async create(@Body() body: CreateCustomerBody) {
    const input = this.validateInput(body, { requireName: true });

    if (await this.hasNameDuplicate(input.name!)) {
      throw new BadRequestException('같은 이름의 고객이 이미 있습니다.');
    }

    // 고객별 DEK 발급 → KEK로 wrap → key_slot, 필드는 DEK로 암호화
    const dek = this.crypto.generateDek();
    const created = await this.prisma.customer.create({
      data: {
        keySlot: this.crypto.wrapDek(dek),
        nameEnc: this.crypto.encryptField(input.name, dek)!,
        phoneEnc: this.crypto.encryptField(input.phone, dek),
        emailEnc: this.crypto.encryptField(input.email, dek),
        memoEnc: this.crypto.encryptField(input.memo, dek),
      },
    });
    return { id: created.id, name: maskName(input.name!), created: true };
  }

  /** 고객 수정 — 기존 DEK(key_slot unwrap)로 변경 필드를 재암호화. */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateCustomerBody) {
    const row = await this.prisma.customer.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('고객을 찾을 수 없습니다.');

    const input = this.validateInput(body, { requireName: false });
    const dek = this.crypto.unwrapDek(row.keySlot);

    if (input.name !== undefined && input.name !== null) {
      if (await this.hasNameDuplicate(input.name, id)) {
        throw new BadRequestException('같은 이름의 고객이 이미 있습니다.');
      }
    }

    // PATCH는 "요청에 명시된 필드만" 수정한다 — 누락된 키는 값 보존(부분 수정 의미론).
    // validateInput은 누락 키도 null로 정규화하므로, 원본 body에 키가 존재하는지로 구분한다.
    const provided = (body ?? {}) as Record<string, unknown>;
    const data: Record<string, string> = {};
    if ('name' in provided && input.name !== undefined && input.name !== null) data.nameEnc = this.crypto.encryptField(input.name, dek)!;
    if ('phone' in provided) data.phoneEnc = this.crypto.encryptField(input.phone, dek);
    if ('email' in provided) data.emailEnc = this.crypto.encryptField(input.email, dek);
    if ('memo' in provided) data.memoEnc = this.crypto.encryptField(input.memo, dek);
    if (Object.keys(data).length > 0) {
      await this.prisma.customer.update({ where: { id }, data });
    }
    return this.detail(id);
  }

  /**
   * 같은 이름 고객 존재 여부 — 암호문은 nonce마다 달라 DB 비교 불가 → 전수 복호화 비교.
   * 데모 규모(n=고객 수)에서 허용 가능한 비용.
   */
  private async hasNameDuplicate(name: string, excludeId?: string): Promise<boolean> {
    const rows = await this.prisma.customer.findMany({
      select: { id: true, keySlot: true, nameEnc: true },
    });
    for (const r of rows) {
      if (excludeId && r.id === excludeId) continue;
      try {
        const dek = this.crypto.unwrapDek(r.keySlot);
        if (this.crypto.decryptField(r.nameEnc, dek) === name) return true;
      } catch {
        // DEK/암호문 불량 행은 중복 비교 대상에서 제외(데이터 문제는 상세 조회 시 노출)
      }
    }
    return false;
  }

  /** 입력 검증(최소수집) — name 필수(등록 시), 문자열·길이 제한, 공백 정리. */
  private validateInput(
    body: unknown,
    opts: { requireName: boolean },
  ): { name?: string | null; phone?: string | null; email?: string | null; memo?: string | null } {
    const b = (body ?? {}) as Record<string, unknown>;
    const out: { name?: string | null; phone?: string | null; email?: string | null; memo?: string | null } = {};

    const str = (key: string, max: number): string | null | undefined => {
      const v = b[key];
      if (v === undefined || v === null) return null;
      if (typeof v !== 'string') throw new BadRequestException(`${key}는 문자열로 입력하세요.`);
      const trimmed = v.trim();
      if (trimmed.length > max) throw new BadRequestException(`${key}는 ${max}자 이하로 입력하세요.`);
      return trimmed.length === 0 ? null : trimmed;
    };

    const name = str('name', CustomersController.LIMITS.name);
    if (opts.requireName && (!name || name.length === 0)) {
      throw new BadRequestException('이름은 필수입니다.');
    }
    out.name = name ?? null;
    out.phone = str('phone', CustomersController.LIMITS.phone);
    out.email = str('email', CustomersController.LIMITS.email);
    out.memo = str('memo', CustomersController.LIMITS.memo);
    return out;
  }
}

interface CreateCustomerBody {
  name?: string;
  phone?: string;
  email?: string;
  memo?: string;
}
type UpdateCustomerBody = CreateCustomerBody;

/** 이름 마스킹 — 첫 글자 + '**' (예: 김건강 → 김**). */
export function maskName(name: string): string {
  const first = Array.from(name)[0];
  return first ? `${first}**` : '**';
}

/** 연락처 마스킹 — 숫자 뒤 4자리만 표시 (예: 010-1234-5678 → ****5678). */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return last4.length === 4 ? `****${last4}` : '****';
}

/** 이메일 마스킹 — 첫 글자 + '***' + 도메인 (예: kim@example.com → k***@example.com). */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}