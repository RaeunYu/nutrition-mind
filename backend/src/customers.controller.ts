import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { PrismaService } from './prisma.service';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 고객 목록 + 고객:성분 1:N (AC9 시딩 데이터 확인용).
   * 인가: 영업·상담 담당자 + 운영 확인을 위한 총관리자.
   * 제품기획·마케팅 담당자는 고객 개인정보에 접근하지 않는다(ADR-0001) → 403.
   */
  @Roles('consultant', 'admin')
  @Get()
  async list() {
    return this.prisma.customer.findMany({
      include: { ingredients: true },
      orderBy: { name: 'asc' },
    });
  }
}
