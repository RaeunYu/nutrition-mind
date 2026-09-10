import { colors, font } from '../lib/design';

export const metadata = { title: 'Nutrition Mind 데모', description: '건강기능식품 법령·기능성 정보 조회 데모' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* DESIGN.md 타이포: Sofia Sans(오픈소스 대체) — 오프라인/차단 시 Arial로 우아하게 강등 */}
        <link
          href="https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@400;450;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        style={{
          fontFamily: "'Sofia Sans', Arial, sans-serif",
          margin: 0,
          // DESIGN.md: 기본 배경은 캔버스 크림 — 순수 흰색 금지(도구 UI 번역 원칙)
          background: colors.canvasCream,
          color: colors.ink,
        }}
      >
        {children}
      </body>
    </html>
  );
}