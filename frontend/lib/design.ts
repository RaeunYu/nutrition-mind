/**
 * DESIGN.md(마스터카드 인스파이어드 시스템)의 도구 UI 번역 토큰 — 이슈 #21.
 *
 * 번역 원칙(#21 판정): 마스터카드 마케팅 페이지 언어를 담당자 도구 UI로 번역한다 —
 *  - 기본 배경은 캔버스 크림(#F3F0EE), 흰 순수 배경은 쓰지 않는다.
 *  - 카드는 Lifted Cream(#FCFBFA)에 40px 코너(스타디움), 버튼은 잉크 필 20px 필(pill).
 *  - 강조(신호) 색은 Signal Orange(#CF4500)를 컴플라이언스·경고 계열에만 사용한다.
 *  - 데이터 밀도 높은 화면(테이블·폼)은 원형 마스크·비대칭 배치를 강제하지 않는다.
 */

export const colors = {
  canvasCream: '#F3F0EE',   // 페이지 캔버스(순수 흰색 금지)
  liftedCream: '#FCFBFA',   // 카드·섹션 표면
  ink: '#141413',           // 주요 CTA·텍스트·푸터
  charcoal: '#262627',
  slateGray: '#696969',     // 보조 텍스트
  dustTaupe: '#D1CDC7',     // 비활성·위스퍼 텍스트
  signalOrange: '#CF4500',  // 컴플라이언스·법정 액션 전용
  lightOrange: '#F37338',   // 액센트(장식 궤도선) 전용
  linkBlue: '#3860BE',
  white: '#FFFFFF',
  border: '#E8E2DA',        // 크림 위 보더
} as const;

export const radius = {
  btn: 20,        // 버튼 시그니처 반경
  stadium: 40,    // 큰 컨테이너·카드
  pill: 999,      // 내비·칩·배지
} as const;

export const font = {
  family: "'Sofia Sans', Arial, sans-serif",
} as const;

/** 페이지 본문 컨테이너 — 도구 화면 표준 프레임. */
export const pageContainer: React.CSSProperties = {
  maxWidth: 820,
  margin: '24px auto',
  padding: 28,
  background: '#FCFBFA',
  borderRadius: 40,
  border: `1px solid ${colors.border}`,
  fontFamily: font.family,
};

/** 주요 CTA — 잉크 필(Ink Pill, 20px). */
export const btnPrimary: React.CSSProperties = {
  padding: '8px 22px',
  borderRadius: radius.btn,
  background: colors.ink,
  color: '#F3F0EE',
  border: `1.5px solid ${colors.ink}`,
  cursor: 'pointer',
  fontSize: 14,
  fontFamily: font.family,
  letterSpacing: '-0.3px',
};

/** 보조 버튼 — 흰색 아웃라인 필. */
export const btnSecondary: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: radius.btn,
  background: colors.white,
  color: colors.ink,
  border: `1.5px solid ${colors.ink}`,
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: font.family,
};

/** 입력 필드 — 흰 바탕 + 잉크 저투명 보더(999px 대신 소프트 필, 도구 UI 번역). */
export const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: 10,
  marginBottom: 8,
  boxSizing: 'border-box',
  background: colors.white,
  border: '1px solid rgba(20,20,19,0.25)',
  borderRadius: 12,
  fontFamily: font.family,
  fontSize: 14,
  color: colors.ink,
};

/** 섹션 카드 — Lifted Cream + 경량 보더. */
export const sectionCard: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radius.stadium,
  padding: 20,
  background: colors.liftedCream,
  fontFamily: font.family,
};

/** 상태 배지 — 필 형태. */
export const pillBadge = (background: string, color: string): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 700,
  padding: '3px 10px',
  borderRadius: radius.pill,
  background,
  color,
});

/** 공통 헤더(잉크 바) — 기존 workspace-header와 톤 일치. */
export const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 20px', background: colors.ink, color: '#F3F0EE', gap: 12,
};

/** 안내 텍스트. */
export const mutedText: React.CSSProperties = {
  color: colors.slateGray,
  fontSize: 13,
  fontFamily: font.family,
};

/** 페이지 H1. */
export const pageH1: React.CSSProperties = {
  fontSize: 20,
  marginTop: 8,
  letterSpacing: '-0.4px',
  color: colors.ink,
  fontFamily: font.family,
};