/**
 * 인증 세션 헬퍼 (클라이언트 전용).
 * 로그인 성공 시 /auth/login 응답을 localStorage에 보관하고, 역할별 홈 경로를 제공한다.
 */

export const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

/** 역할 코드 — 백엔드 Role 테이블 role_id와 일치 */
export type Role = 'admin' | 'consultant' | 'marketing';

export interface Auth {
  accessToken: string;
  email: string;
  role: Role;
  roleLabel: string;
}

export const AUTH_KEY = 'nm_auth';

/** 역할별 로그인 후 홈 경로 */
export const ROLE_HOME: Record<Role, string> = {
  consultant: '/',          // 상담 워크스페이스 홈 (챗봇)
  marketing: '/marketing',  // 마케팅 화면 골격 (#19, #20이 채움)
  admin: '/admin',          // 관리 화면 골격 (#14가 채움)
};

export function getAuth(): Auth | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Auth;
    if (!parsed.accessToken || !parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setAuth(auth: Auth): void {
  window.localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export function clearAuth(): void {
  window.localStorage.removeItem(AUTH_KEY);
}