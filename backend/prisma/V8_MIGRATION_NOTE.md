# Prisma v8 마이그레이션 참고 노트

> **작성 시점**: 2026-09 · **현재 버전**: Prisma **v7.10.0** (고정)
> **대상 에이전트/개발자**: 이 프로젝트에서 Prisma를 이어서 다루는 사람

## 왜 v7에 고정했는가

- v8은 아직 RC 상태(`8.0.0-rc.x`)이며, major 변경점이 많아 불확실성이 큼.
- 안정성을 위해 **v7 최신 안정판(7.10.0)으로 고정**. v8 정식 출시 후 아래 절차로 마이그레이션할 것.

## v7에서 v8로 넘어갈 때 확인할 것 (체크리스트)

1. **v8 정식 릴리스 노트 확인** — 특히 `prisma-client` 제너레이터 출력물 구조 변경 여부
   (본 프로젝트는 v7 신규 제너레이터 `prisma-client` + 커스텀 output(`src/generated/prisma`) 사용 중).
2. **`prisma.config.ts` 유지** — v7부터 도입된 설정 파일 방식. v8에서도 유지되는지 확인.
3. **드라이버 어댑터** — `@prisma/adapter-pg` 기반 연결(`PrismaService` 참고).
   v8에서 어댑터 API 시그니처 변경 여부 확인.
4. **`Unsupported("vector(1024)")` 필드** — pgvector 필드는 Prisma가 타입 미지원 → 원시 SQL 사용 중.
   v8에서 벡터 타입 네이티브 지원 여부 확인.
5. **CHECK 제약** — `law_type`, `reference_type`의 CHECK는 Prisma 마이그레이션으로 관리되지 않음
   (인트로스펙션 경고 확인). v8에서 CHECK 지원 여부 확인.
6. **마이그레이션 베이스라인** — DB는 수동 SQL(`db/init/01_schema.sql`)로 초기화됨.
   `prisma migrate diff --from-empty --to-schema`로 생성한 베이스라인 정책 유지.
7. **seed** — `prisma.config.ts`의 `migrate.seed`로 `tsx prisma/seed.ts` 실행 중.
   v8에서 seed 설정 위치 변경 여부 확인.

## 업그레이드 절차 (요약)

```bash
npm install prisma@latest @prisma/client@latest @prisma/adapter-pg@latest
npx prisma validate
npx prisma generate
npx prisma db seed   # 멱등 시딩 확인
npm run build && docker-compose up -d --build backend
```
