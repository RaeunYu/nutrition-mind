import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { PrismaService } from './prisma.service';

/**
 * 성분 마스터 API (이슈 #16).
 *
 * 표준 성분 목록(성분명·동의어·키워드 — 쉼표 구분 텍스트). 관심 성분 선택 UI와
 * 원료명 → 성분 키워드 규칙 매핑(ingredient-mapping.service)의 규칙 소스다.
 * 용어: 성분(표준 성분명) ≠ 원료(식약처 원재료명 텍스트) — 혼용 금지(CONTEXT.md).
 *
 * 인가: 고객 화면 API와 동일 가드(영업·상담 담당자 + 총관리자). 성분 마스터 자체는
 * 개인정보가 아니지만, 소비 화면이 고객 상세이므로 동일 역할 범위로 상속한다(이슈 #16 설계).
 */
@Controller('ingredients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('consultant', 'admin')
export class IngredientsController {
  constructor(private readonly prisma: PrismaService) {}

  /** 성분 마스터 목록 — 마스터 등록(시딩) 순서로 반환(매핑 규칙 순서와 일치). */
  @Get()
  async list() {
    const rows = await this.prisma.ingredient.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      synonyms: row.synonyms,
      keywords: row.keywords,
    }));
  }
}