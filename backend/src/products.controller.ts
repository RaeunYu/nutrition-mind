import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ProductsService, ProductSearchField, ProductSearchResult } from './products.service';

/**
 * 품목제조신고 제품 검색 API (이슈 #12).
 * 이슈 #15(섭취 제품 등록)·#16(성분 매핑)의 전제가 되는 선작업 — UI는 없음.
 * 인증: 담당자 로그인(JWT) 필수 — 기존 /chat·/customers와 동일한 보호 수준.
 */
@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /**
   * GET /products/search?query=&field=product|rawMaterial&limit=&offset=
   * - query(필수): 제품명 또는 원료명 부분일치 키워드
   * - field(기본 product): 검색 대상 칼럼(제품명=product / 원료명=rawMaterial)
   * - limit(기본 20, 최대 100) / offset(기본 0)
   * 응답: { query, field, total, limit, offset, items[제품명·원료명·기능성·신고번호·api_code] }
   */
  @Get('search')
  async search(
    @Query('query') query?: string,
    @Query('field') field?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ProductSearchResult> {
    if (field !== undefined && field !== '' && field !== 'product' && field !== 'rawMaterial') {
      throw new BadRequestException('field 파라미터는 product 또는 rawMaterial이어야 합니다.');
    }
    return this.products.search({
      query: query ?? '',
      field: (field as ProductSearchField) || 'product',
      limit: limit === undefined || limit === '' ? undefined : Number(limit),
      offset: offset === undefined || offset === '' ? undefined : Number(offset),
    });
  }
}