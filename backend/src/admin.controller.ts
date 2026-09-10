import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { AccessLogService } from './access-log.service';

/**
 * 총관리자(admin) 전용 관리 API (ADR-0002, 이슈 #14).
 *
 * - GET /admin/access-logs: 고객 개인정보 접근 로그 조회.
 *   제품기획·마케팅/영업·상담 담당자는 접근할 수 없다(가드 403) — 기록 열람은 총관리자 전용.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly accessLogService: AccessLogService) {}

  /** 고객 개인정보 접근 로그 조회 — 최신 순(기본 100건, 최대 200건). */
  @Get('access-logs')
  async accessLogs(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    const items = await this.accessLogService.list(Number.isFinite(parsed) ? parsed : 100);
    return { total: items.length, items };
  }
}