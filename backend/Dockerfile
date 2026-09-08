FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
# Prisma v7: 스키마/설정 복사 후 클라이언트 생성
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate
COPY src ./src
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/main.js"]
