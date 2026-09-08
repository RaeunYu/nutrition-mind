# 🧪 Nutrition Mind — 건강기능식품 법령·기능성 정보 RAG·MCP 데모

건강기능식품 관련 법령(조문 단위 RAG)과 식약처 기능성 정보(구조화 조회)를 조회하는
**로컬 Docker Compose 포트폴리오 데모**입니다.

> 스펙 근거: [`seed.yaml`](./seed.yaml) · 배경 컨텍스트: [`project-background-context.md`](./project-background-context.md)
> 스키마 문서: [`foodsafetykorea_schema/`](./foodsafetykorea_schema/)

## 📦 구성

| 서비스 | 포트 | 설명 |
|---|---|---|
| `frontend` (Next.js) | 3000 | JWT 로그인 + 최소 기능 챗봇 데모 |
| `backend` (NestJS) | 3001 | 인증·챗 API (LangGraph 6단계 파이프라인은 Task #4에서 연결) |
| `mcp` (Python FastMCP) | 8000 | MCP 도구 4종 + 토큰 기반 간단 인증 |
| `db` (PostgreSQL + pgvector) | 5432 | legal_provisions / provision_references / 식약처 데이터 |

법령 스키마 방향(확정): `legal_provisions`(조문 1개=청크 1개, `law_type` 포함 — 표시기준은 `administrative_rule`) + `provision_references`(위임/인용 엣지). 자세한 배경은 `project-background-context.md` 1장을 참고하세요.

## 🚀 빠른 시작

### 1) 환경설정 (.env)

```bash
cp .env.example .env
# .env 파일을 직접 편집해 LLM API 키를 입력하세요.
```

bash/zsh 명령어로 직접 추가하는 예시:

```bash
# bash
echo 'OPENAI_API_KEY=sk-...' >> .env
# zsh
echo 'OPENAI_API_KEY=sk-...' >> .env
```

### 2) MCP 토큰 발급

```bash
openssl rand -hex 32   # 출력값을 .env의 MCP_TOKEN에 붙여넣기
```

### 3) Ollama 임베딩 모델 준비 (호스트에서)

```bash
ollama pull qwen3-embedding:0.6b
```

### 4) 실행

```bash
docker compose up -d --build
```

- 웹 데모: http://localhost:3000 (기본 계정: `demo@example.com` / `demo1234`)
- 백엔드 헬스체크: http://localhost:3001/health
- MCP 헬스체크: http://localhost:8000/health

## 🔑 MCP 토큰 사용법

MCP 서버는 `Authorization: Bearer <MCP_TOKEN>` 헤더를 요구합니다:

```bash
TOKEN=$(grep '^MCP_TOKEN=' .env | cut -d= -f2)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/health
```

MCP 도구 4종: `search_legal_provisions`, `get_functional_ingredient`, `get_product_report`, `get_notified_functionality`

## 🗺️ 구현 현황 (GitHub Issues)

- [x] #2 프로젝트 골격 및 Docker Compose 인프라 구성
- [ ] #3 국가법령정보센터 법령 수집 및 legal_provisions 스키마 저장
- [ ] #4 법령 RAG 파이프라인 및 LangGraph 6단계 노드 구현
- [ ] #5 식약처 기능성 정보 구조화 조회 및 total_count 증분 갱신
- [ ] #6 FastMCP 도구 노출 및 토큰 기반 인증 구현 (도구 스텁 완료, DB 연동은 #5 이후)
- [ ] #7 웹 데모: JWT 로그인·고객:성분 시딩·챗봇 (로그인/챗봇 스텁 완료)
- [ ] #8 RAG 평가 지표(Recall@k·MRR) 및 한국어 문서화 완성

Epic: https://github.com/RaeunYu/nutrition-mind/issues/1

## 📚 참고

- 법령 참조 확장의 "관련/참고 3단 출처 구분"은 품질 개선 후보로 내부 문서에 기록 예정 (seed.yaml decisions)
- QMD는 초기 설계에 최소 연동만 포함, Graphify는 코드베이스 온보딩 전용 (비-목표: Neo4j, 소셜 로그인, 클라우드 배포)
