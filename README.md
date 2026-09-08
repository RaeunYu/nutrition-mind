# 🧪 Nutrition Mind — 건강기능식품 법령·기능성 정보 RAG·MCP 데모

건강기능식품 관련 법령(조문 단위 RAG)과 식약처 기능성 정보(구조화 조회)를 조회하는
**로컬 Docker Compose 포트폴리오 데모**입니다.

> 스펙 근거: [`seed.yaml`](./seed.yaml) · 배경 컨텍스트: [`project-background-context.md`](./project-background-context.md)
> 스키마 문서: [`foodsafetykorea_schema/`](./foodsafetykorea_schema/)

## 📦 구성

| 서비스 | 포트 | 설명 |
|---|---|---|
| `frontend` (Next.js) | 3000 | JWT 로그인 + 최소 기능 챗봇 데모 |
| `backend` (NestJS + **Prisma v7**) | 3001 | 인증·챗 API, ORM: Prisma v7 (`prisma-client` 제너레이터 + driver adapter). LangGraph 6단계 파이프라인은 Task #4에서 연결 |
| `mcp` (Python FastMCP) | 8000 | MCP 도구 4종 + 토큰 기반 간단 인증 |
| `db` (PostgreSQL + pgvector) | 5432 | legal_provisions / provision_references / 식약처 데이터 |

법령 스키마 방향(확정): `legal_provisions`(조문 1개=청크 1개, `law_type` 포함 — 표시기준은 `administrative_rule`) + `provision_references`(위임/인용 엣지). 자세한 배경은 `project-background-context.md` 1장을 참고하세요.

## 🚀 빠른 시작

### 1) 환경설정 (.env)

```bash
cp .env.example .env
# .env 파일을 직접 편집해 LLM API 키를 입력하세요.
```

**LLM 합성(선택사항)** — 챗봇의 자연어 답변 생성용. 3개 플랫폼 지원:
- `LLM_PROVIDER=openai` (기본): OpenAI GPT — `LLM_API_KEY` 필수
- `LLM_PROVIDER=anthropic`: Claude — `LLM_API_KEY` 필수
- `LLM_PROVIDER=ollama`: 로컬 Ollama — 키 불필요 (예: `LLM_MODEL=glm-5.3-flash:cloud`)

`LLM_API_KEY`가 비어있거나 호출 실패 시, 챗봇은 **근거 조문 나열 모드로 자동 폴백**하며
응답의 `notices`에 사유를 표시합니다 (임베딩은 항상 로컬 Ollama 사용).

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

### 4) DB 마이그레이션/시딩 (Prisma)

```bash
cd backend
npx prisma generate        # 클라이언트 생성
npx prisma db seed         # 데모 시딩(멱등) — 고객:성분 1:N, 데모 사용자
# 대용량 식약처 CSV는 Prisma 시딩이 아닌 전용 스크립트 사용:
# ../ingest/load_foodsafety_csv.py (46,000건×2 — 효율상 Python 유지)
```

> Prisma는 **v7.10.0 고정**. v8은 RC 상태로 불확실성이 있어 고정했으며, 추후 마이그레이션 절차는
> [`backend/prisma/V8_MIGRATION_NOTE.md`](./backend/prisma/V8_MIGRATION_NOTE.md)에 기록해 두었습니다.

### 5) 실행

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
- [x] #4 법령 RAG 파이프라인 및 LangGraph 6단계 노드 구현 (359조문 임베딩·pgvector 검색·6단계 그래프 동작) — RAG 평가지표 스크립트는 #8에서
- [ ] #5 식약처 기능성 정보 구조화 조회 및 total_count 증분 갱신
- [x] #6 FastMCP 도구 노출 및 토큰 기반 인증 구현 (법령검색은 pgvector 벡터 검색 연동 완료)
- [ ] #7 웹 데모: JWT 로그인·고객:성분 시딩·챗봇 (로그인/챗봇 스텁 완료)
- [x] #8 RAG 평가 지표: `ingest/eval_rag.py` — Recall@5 1.000 / MRR 0.792 (8문항 골드셋)

Epic: https://github.com/RaeunYu/nutrition-mind/issues/1

## 🗂️ Obsidian Vault 운영 (AC12)

이 프로젝트의 결정 기록(ADR)과 회의록은 **단일 전역 Vault + symlink** 방식으로 관리합니다.
- 운영 방식·3계층 구조·QMD 최소 연동 설계: [`docs/obsidian-vault.md`](./docs/obsidian-vault.md)
- 요약: 프로젝트 Vault를 만들지 않고 `~/ObsidianVault/Projects/nutrition-mind/`에 symlink로 연결.
  Raw(원본) / Distilled(요약) / Decisions(ADR) 3계층 유지. QMD는 Raw가 500개 이상 쌓인 후 도입 검토(현 단계 미도입).

## 📚 참고

- ⚠️ 식품안전나라 openapi는 **KST 09:00~19:00 호출 차단** (ERROR-503). 증분 갱신 잡은 19시 이후 실행. 상세 응답 코드는 [`foodsafetykorea_schema/api_response_schema_doc.md`](./foodsafetykorea_schema/api_response_schema_doc.md) 참고.

- 법령 참조 확장의 "관련/참고 3단 출처 구분"은 품질 개선 후보로 내부 문서에 기록 예정 (seed.yaml decisions)
- QMD는 초기 설계에 최소 연동만 포함, Graphify는 코드베이스 온보딩 전용 (비-목표: Neo4j, 소셜 로그인, 클라우드 배포)
