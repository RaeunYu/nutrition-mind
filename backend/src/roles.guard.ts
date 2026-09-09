import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

/**
 * 역할 가드 (간소화 RBAC — ADR-0001).
 * JwtAuthGuard가 검증한 JWT의 role 클레임을 @Roles 목록과 비교해 인가를 판정한다.
 * 반드시 JwtAuthGuard 뒤에서 함께 적용한다: @UseGuards(JwtAuthGuard, RolesGuard)
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(), // 메서드 지정 우선
      context.getClass(),   // 없으면 컨트롤러 지정
    ]);
    if (!required || required.length === 0) return true; // @Roles 미지정: 인가 규칙 없음(인증만 적용)

    const req = context.switchToHttp().getRequest();
    const role: string | undefined = req.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('이 계정의 역할은 접근 권한이 없습니다.');
    }
    return true;
  }
}