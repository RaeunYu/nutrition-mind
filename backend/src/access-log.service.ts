import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 접근 로그 서비스 (ADR-0002, 이슈 #14).
 *
 * - 기록 대상: 고객 개인정보가 "복호화되어 노출"되는 화면 접근(고객 상세).
 *   목록은 마스킹만 노출하므로 기록 대상이 아니다(최소노출 원칙).
 * - actor_email·actor_role은 접근 시점의 JWT 클레임을 비정규화해 저장한다
 *   (사용자 삭제 후에도 기록이 유지되어야 하기 때문).
 * - 조회는 총관리자(admin)만 가능하다 — AdminController의 가드가 담당.
 */
@Injectable()
export class AccessLogService {
  constructor(private readonly prisma: PrismaService) {}

  /** 고객 개인정보 노출 화면 접근 1건을 기록한다. 기록 실패는 조회 자체를 막지 않는다(감사 보조 기능). */
  async record(actor: { email?: string; role?: string }, customerId: string): Promise<void> {
    try {
      await this.prisma.accessLog.create({
        data: {
          actorEmail: actor.email ?? 'unknown',
          actorRole: actor.role ?? 'unknown',
          customerId,
        },
      });
    } catch (e) {
      console.error('[access-log] 접근 기록 실패(요청은 계속 처리됨):', (e as Error).message);
    }
  }

  /** 접근 로그 조회 — 최신 순. 데모 규모에서 limit 클램프는 500. */
  list(limit: number): Promise<Array<{ id: string; actorEmail: string; actorRole: string; customerId: string; accessedAt: Date }>> {
    const safeLimit = Math.min(Math.max(Number.isFinite(limit) ? limit : 100, 1), 200);
    return this.prisma.accessLog.findMany({
      orderBy: { accessedAt: 'desc' },
      take: safeLimit,
      select: {
        id: true,
        actorEmail: true,
        actorRole: true,
        customerId: true,
        accessedAt: true,
      },
    });
  }
}