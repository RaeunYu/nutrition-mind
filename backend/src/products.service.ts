import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** 검색 대상 필드: 제품명(product) | 원료명(rawMaterial) — 품목제조신고 제품(이슈 #12) + 원료형 데이터(이슈 #20) */
export type ProductSearchField = 'product' | 'rawMaterial';

/** 검색 결과 1건 — 품목제조신고 제품의 정규화 칼럼(백필) 값 */
export interface ProductSearchItem {
  productName: string;
  rawMaterialName: string | null;
  functionalityText: string | null;
  intakeNote: string | null;
  reportNo: string | null;
  apiCode: string;
}

/** 검색 응답 — 페이지네이션 메타 + 결과 목록 */
export interface ProductSearchResult {
  query: string;
  field: ProductSearchField;
  total: number;
  limit: number;
  offset: number;
  items: ProductSearchItem[];
}

/** LIMIT 최댓값(과다 조회 방지) */
const MAX_LIMIT = 100;

/**
 * 품목제조신고 제품 검색 서비스 (이슈 #12).
 * foodsafety_rows(C003·I0030)의 정규화 칼럼을 ILIKE 부분일치로 조회한다.
 * pg_trgm GIN 인덱스(idx_foodsafety_rows_product_name·raw_material)가
 * ILIKE '%…%' 패턴을 지원하므로 원시 SQL로 질의한다.
 */
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 품목제조신고 제품 검색.
   * - field='product': 제품명(product_name) 부분일치 / 'rawMaterial': 원료명(raw_material_name) 부분일치
   * - 사용자 입력의 % _ \ 는 이스케이프해 와일드카드 오용을 막는다.
   * - 정렬: 검색 대상 칼럼 오름차순 + id(타이브레이크) → 페이지네이션 재현 가능.
   */
  async search(params: {
    query: string;
    field: ProductSearchField;
    limit?: number;
    offset?: number;
  }): Promise<ProductSearchResult> {
    const query = (params.query ?? '').trim();
    if (!query) {
      throw new BadRequestException('검색어(query)를 입력하세요.');
    }

    const limit = clampInt(params.limit, 20, 1, MAX_LIMIT, 'limit');
    const offset = clampInt(params.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');

    const column = params.field === 'rawMaterial' ? 'raw_material_name' : 'product_name';
    const pattern = `%${escapeLike(query)}%`;

    const apiCodes = params.field === 'rawMaterial' ? "('C003','I0030','I-0040','I-0050')" : "('C003','I0030')";
    const whereSql = `api_code IN ${apiCodes} AND ${column} ILIKE $1`;

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        product_name: string;
        raw_material_name: string | null;
        functionality_text: string | null;
        intake_note: string | null;
        report_no: string | null;
        api_code: string;
      }>
    >(
      `SELECT product_name, raw_material_name, functionality_text, intake_note, report_no, api_code
       FROM foodsafety_rows
       WHERE ${whereSql}
       ORDER BY ${column} ASC, id ASC
       LIMIT $2 OFFSET $3`,
      pattern,
      limit,
      offset,
    );

    const totalRow = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM foodsafety_rows WHERE ${whereSql}`,
      pattern,
    );

    return {
      query,
      field: params.field,
      total: Number(totalRow[0]?.count ?? 0),
      limit,
      offset,
      items: rows.map((r) => ({
        productName: r.product_name,
        rawMaterialName: r.raw_material_name,
        functionalityText: r.functionality_text,
        intakeNote: r.intake_note,
        reportNo: r.report_no,
        apiCode: r.api_code,
      })),
    };
  }
}

/** LIKE·ILIKE 와일드카드 문자 이스케이프(\ % _) */
function escapeLike(input: string): string {
  return input.replace(/([\\%_])/g, '\\$1');
}

/** 정수 파라미터 정규화(기본값·하한·상한 클램프, 비숫자 입력은 400) */
function clampInt(raw: unknown, defaultValue: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new BadRequestException(`${name} 파라미터는 정수여야 합니다.`);
  }
  return Math.min(Math.max(n, min), max);
}