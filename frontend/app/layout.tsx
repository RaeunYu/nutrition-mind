export const metadata = { title: 'Nutrition Mind 데모', description: '건강기능식품 법령·기능성 정보 조회 데모' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ fontFamily: 'sans-serif', margin: 0, background: '#f7f7f8' }}>
        {children}
      </body>
    </html>
  );
}
