import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from './prisma.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly prisma: PrismaService) {}

  /** 고객 목록 + 고객:성분 1:N (AC9 시딩 데이터 확인용) */
  @UseGuards(JwtAuthGuard)
  @Get()
  async list() {
    return this.prisma.customer.findMany({
      include: { ingredients: true },
      orderBy: { name: 'asc' },
    });
  }
}
