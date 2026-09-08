FROM node:20-alpine
WORKDIR /app
ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
COPY package.json tsconfig.json next.config.mjs ./
RUN npm install
COPY app ./app
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
