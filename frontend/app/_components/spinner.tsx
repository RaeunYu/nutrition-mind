'use client';

/** DESIGN.md 잉크 필 버튼용 인라인 로딩 스피너(버튼 내부 배치, 이슈 #25). */
export default function Spinner({ size = 14, color = '#F3F0EE' }: { size?: number; color?: string }) {
  return (
    <span
      className="nm-spinner"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        marginRight: 6,
        border: `2px solid rgba(243,240,238,0.35)`,
        borderTopColor: color,
        borderRadius: '50%',
        verticalAlign: 'middle',
      }}
    />
  );
}