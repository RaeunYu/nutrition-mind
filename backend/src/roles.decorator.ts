import { SetMetadata } from '@nestjs/common';

/** @Roles 데코레이터가 심는 메타데이터 키. */
export const ROLES_KEY = 'roles';

/**
 * 이 엔드포인트에 접근 가능한 역할 목록을 지정한다 (간소화 RBAC — ADR-0001).
 * 역할 코드는 Role 테이블의 role_id('admin' | 'consultant' | 'marketing')와 일치.
 * 예: @Roles('consultant', 'admin')
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);