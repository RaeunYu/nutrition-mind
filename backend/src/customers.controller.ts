import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { PrismaService } from './prisma.service';
import { CryptoService } from './crypto.service';
import { AccessLogService } from './access-log.service';
import {
  IngredientMappingService,
  MaterialInput,
  IngredientRule,
  InterestRef,
} from './ingredient-mapping.service';

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
    private readonly accessLog: AccessLogService,
    private readonly mapping: IngredientMappingService,
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

  /** 고객 상세 — 개인식별 필드 복호화(상담 담당자 조회 용도). 접근 시 기록을 남긴다(ADR-0002, 이슈 #14). */
  @Get(':id')
  async detail(@Param('id') id: string, @Req() req: { user?: { email?: string; role?: string } }) {
    const row = await this.prisma.customer.findUnique({
      where: { id },
      include: { ingredients: true },
    });
    if (!row) throw new NotFoundException('고객을 찾을 수 없습니다.');
    await this.accessLog.record(req.user ?? {}, id); // 개인정보 노출 화면 접근 기록(총관리자 열람 — 이슈 #14)
    const dek = this.crypto.unwrapDek(row.keySlot);
    const intakeProducts = await this.listIntakeProducts(id);
    const interests = await this.listInterests(id);
    return {
      id: row.id,
      name: this.crypto.decryptField(row.nameEnc, dek),
      phone: this.crypto.decryptField(row.phoneEnc, dek),
      email: this.crypto.decryptField(row.emailEnc, dek),
      memo: this.crypto.decryptField(row.memoEnc, dek),
      ingredients: row.ingredients
        .map((ci) => ci.ingredientName)
        .sort((a, b) => a.localeCompare(b, 'ko')),
      interests,
      intakeProducts,
    };
  }

  /** 섭취 제품 목록 — 고객 상세 화면의 섭취 제품 섹션용(개인정보 아님, 마스킹·기록 불필요). */
  @Get(':id/products')
  async intakeProducts(@Param('id') id: string) {
    await this.ensureCustomer(id);
    return this.listIntakeProducts(id);
  }

  /**
   * 섭취 제품 연결/등록 (이슈 #15).
   * - source=foodsafety: 품목제조신고 제품 연결 — api_code+report_no 조합으로 식별(#12: 동일 report_no가 C003·I0030에 공존).
   *   연결 시 제품 정보(제품명·원료·기능성)를 스냅샷으로 저장한다(원본 payload 변경과 무관하게 표시 안정성 유지).
   * - source=manual: 식약처 미수록 제품을 담당자가 수동 등록.
   */
  @Post(':id/products')
  async addIntakeProduct(
    @Param('id') id: string,
    @Body() body: AddIntakeProductBody,
  ) {
    await this.ensureCustomer(id);
    const b = (body ?? {}) as Record<string, unknown>;
    const source = b.source === 'manual' ? 'manual' : b.source === 'foodsafety' ? 'foodsafety' : null;
    if (!source) throw new BadRequestException('source는 foodsafety 또는 manual이어야 합니다.');

    if (source === 'foodsafety') {
      const apiCode = this.plain(b.apiCode, 20);
      const reportNo = this.plain(b.reportNo, 50);
      if (!apiCode || !reportNo) throw new BadRequestException('품목제조신고 연결에는 apiCode·reportNo가 필요합니다.');
      const rows = await this.prisma.$queryRawUnsafe<Array<{ product_name: string; raw_material_name: string | null; functionality_text: string | null }>>(
        'SELECT product_name, raw_material_name, functionality_text FROM foodsafety_rows WHERE api_code = $1 AND report_no = $2 LIMIT 1',
        apiCode, reportNo,
      );
      if (rows.length === 0) throw new NotFoundException('해당 품목제조신고 제품을 찾을 수 없습니다.');
      try {
        const created = await this.prisma.customerProduct.create({
          data: {
            customerId: id,
            source,
            apiCode,
            reportNo,
            productName: rows[0].product_name,
            rawMaterials: rows[0].raw_material_name,
            functionality: rows[0].functionality_text,
          },
        });
        return this.intakeProductView(created.id);
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') {
          throw new BadRequestException('이미 연결된 섭취 제품입니다.');
        }
        throw e;
      }
    }

    // manual 등록
    const productName = this.plain(b.productName, 200);
    if (!productName) throw new BadRequestException('제품명은 필수입니다.');
    const rawMaterials = this.plain(b.rawMaterials, 2000);
    const functionality = this.plain(b.functionality, 2000);
    const dup = await this.prisma.customerProduct.findFirst({
      where: { customerId: id, source, productName },
    });
    if (dup) throw new BadRequestException('이미 등록된 섭취 제품입니다.');
    const created = await this.prisma.customerProduct.create({
      data: { customerId: id, source, productName, rawMaterials, functionality },
    });
    return this.intakeProductView(created.id);
  }

  /** 섭취 제품 제거. */
  @Delete(':id/products/:productId')
  async removeIntakeProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    const deleted = await this.prisma.customerProduct.deleteMany({
      where: { id: productId, customerId: id },
    });
    if (deleted.count === 0) throw new NotFoundException('섭취 제품을 찾을 수 없습니다.');
    return { removed: true };
  }

  /**
   * 관심 성분 지정·변경 (이슈 #16) — 전체 교체(세트) 의미론: 요청한 성분 집합으로 갱신.
   * body { ingredientIds: string[] } — 존재하지 않는 성분 id가 포함되면 404.
   * 빈 배열은 관심 성분 전체 해제로 처리한다.
   */
  @Put(':id/interests')
  async setInterests(@Param('id') id: string, @Body() body: SetInterestsBody) {
    await this.ensureCustomer(id);
    const b = (body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(b.ingredientIds)) {
      throw new BadRequestException('ingredientIds는 배열로 입력하세요.');
    }
    const ids: string[] = [];
    for (const v of b.ingredientIds) {
      if (typeof v !== 'string' || v.trim().length === 0) {
        throw new BadRequestException('ingredientIds 항목은 성분 id 문자열이어야 합니다.');
      }
      const trimmed = v.trim();
      if (!ids.includes(trimmed)) ids.push(trimmed);
    }
    if (ids.length > 50) {
      throw new BadRequestException('관심 성분은 최대 50개까지 지정할 수 있습니다.');
    }
    const found = await this.prisma.ingredient.findMany({ where: { id: { in: ids } } });
    if (found.length !== ids.length) {
      throw new NotFoundException('존재하지 않는 성분이 포함되어 있습니다.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.customerInterest.deleteMany({ where: { customerId: id } });
      if (ids.length > 0) {
        await tx.customerInterest.createMany({
          data: ids.map((ingredientId) => ({ customerId: id, ingredientId })),
        });
      }
    });
    const interests = await this.listInterests(id);
    return { interests, replaced: true };
  }

  /**
   * 성분 갭 (이슈 #16) — 관심 성분 중 섭취 제품으로 커버되지 않는 성분(CONTEXT.md: 성분 갭).
   * 커버 판정 원천: ① 섭취 제품 원료명 텍스트의 키워드 규칙 매핑 ② 수동 성분(customer_ingredients,
   * evidence.source='manual_ingredient' 라벨로 구분). 매핑 실패 원료 목록도 함께 반환한다.
   * 제품·성분 정보는 개인정보가 아니므로 접근 로그를 남기지 않는다(ADR-0002는 개인식별 필드 대상).
   */
  @Get(':id/gap')
  async gap(@Param('id') id: string) {
    await this.ensureCustomer(id);
    const [interestRows, intakeRows, manualRows, rules] = await Promise.all([
      this.prisma.customerInterest.findMany({
        where: { customerId: id },
        include: { ingredient: true },
        orderBy: { ingredient: { createdAt: 'asc' } },
      }),
      this.prisma.customerProduct.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.customerIngredient.findMany({ where: { customerId: id } }),
      this.prisma.ingredient.findMany({ orderBy: { createdAt: 'asc' } }),
    ]);

    const ruleList: IngredientRule[] = rules.map((r) => ({
      id: r.id,
      name: r.name,
      synonyms: r.synonyms,
      keywords: r.keywords,
    }));
    const inputs: MaterialInput[] = [
      ...intakeRows.map((p) => ({
        productName: p.productName,
        rawMaterialText: p.rawMaterials,
        source: 'intake_product' as const,
      })),
      ...manualRows.map((m) => ({
        productName: null,
        rawMaterialText: m.ingredientName,
        source: 'manual_ingredient' as const,
      })),
    ];
    const interests: InterestRef[] = interestRows.map((r) => ({
      ingredientId: r.ingredientId,
      name: r.ingredient.name,
    }));
    return this.mapping.buildGapView(inputs, ruleList, interests);
  }

  /** 관심 성분 목록 — 마스터 등록 순(갭 응답과 같은 순서). */
  private async listInterests(customerId: string) {
    const rows = await this.prisma.customerInterest.findMany({
      where: { customerId },
      include: { ingredient: true },
      orderBy: { ingredient: { createdAt: 'asc' } },
    });
    return rows.map((r) => ({ ingredientId: r.ingredientId, name: r.ingredient.name }));
  }

  /** 고객 수정 — 기존 DEK(key_slot unwrap)로 변경 필드를 재암호화. 응답도 복호화 값을 포함하므로 접근을 기록한다. */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateCustomerBody, @Req() req: { user?: { email?: string; role?: string } }) {
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
    return this.detail(id, req);
  }

  /** 고객 존재 확인(404). */
  private async ensureCustomer(id: string): Promise<void> {
    const row = await this.prisma.customer.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('고객을 찾을 수 없습니다.');
  }

  /** 섭취 제품 목록 — 생성 순 역순(최근 연결 먼저). */
  private async listIntakeProducts(customerId: string) {
    const rows = await this.prisma.customerProduct.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      apiCode: r.apiCode,
      reportNo: r.reportNo,
      productName: r.productName,
      rawMaterials: r.rawMaterials,
      functionality: r.functionality,
    }));
  }

  private async intakeProductView(productId: string) {
    const r = await this.prisma.customerProduct.findUnique({ where: { id: productId } });
    if (!r) throw new NotFoundException('섭취 제품을 찾을 수 없습니다.');
    return {
      id: r.id,
      source: r.source,
      apiCode: r.apiCode,
      reportNo: r.reportNo,
      productName: r.productName,
      rawMaterials: r.rawMaterials,
      functionality: r.functionality,
    };
  }

  /** 문자열 입력 정리(trim + 길이 제한). 빈 문자열·비문자열은 null. */
  private plain(value: unknown, max: number): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > max) throw new BadRequestException(`입력값은 ${max}자 이하로 입력하세요.`);
    return trimmed;
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

interface AddIntakeProductBody {
  source?: 'foodsafety' | 'manual';
  apiCode?: string;
  reportNo?: string;
  productName?: string;
  rawMaterials?: string;
  functionality?: string;
}

/** 관심 성분 지정 요청 본문 (이슈 #16). */
interface SetInterestsBody {
  ingredientIds?: string[];
}

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