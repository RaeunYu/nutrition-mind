import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  // 이슈 #27: Prisma migrate 체계 전환 — datasource URL을 환경변수(DATABASE_URL)에서 읽는다.
  // ShadowDB는 migrate dev가 자동 생성·삭제(nutrition 롤은 superuser여서 CREATEDB 권한 보유).
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://nutrition:nutrition_dev_pw@localhost:5433/nutrition_mind",
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // v7에서는 datasource url을 스키마가 아니라 이곳/환경변수로 관리
  // https://pris.ly/d/config-datasource
});
