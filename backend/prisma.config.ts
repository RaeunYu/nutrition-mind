import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // v7에서는 datasource url을 스키마가 아니라 이곳/환경변수로 관리
  // https://pris.ly/d/config-datasource
});
