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

### 4) DB 마이그레이션/시딩 (Prisma migrate — 이슈 #27 전환)

```bash
cd backend
npx prisma generate        # 클라이언트 생성
npx prisma migrate deploy  # 마이그레이션 적용(빈 DB에서 전체 스키마 재현 — pgvector·trgm 확장 포함)
npx prisma db seed         # 데모 시딩(멱등) — 역할 3종, 데모 계정, 고객 18명, 성분 마스터 17종
# 대용량 식약처 CSV는 Prisma 시딩이 아닌 전용 스크립트 사용:
# ../ingest/load_foodsafety_csv.py (46,000건×2 — 효율상 Python 유지)
```

**스키마 변경 절차**(`prisma/migrations/`로 관리 — 이슈 #27):

```bash
npx prisma migrate dev --name <변경명>   # ShadowDB로 드리프트 검사 후 적용(개발)
npx prisma migrate deploy               # 적용(운영/데모)
npx prisma migrate status               # 히스토리·드리프트 확인
```

- pg_trgm GIN·부분 유니크 인덱스 등 Prisma 미표현 DDL은 `20260910100000_extensions`·
  `20260910120001_trgm_and_partial_indexes` 수동 마이그레이션에 포함되어 있다.
- 빈 DB에서 `migrate deploy`가 전체 스키마(확장 포함)를 재현함을 샘플 DB로 검증했다(이슈 #27).

> 사용자의 요청에 따라 Prisma는 **v7.10.0 고정**. v8은 RC 상태로 불확실성이 있어 고정했으며, 추후 마이그레이션 절차는
> [`backend/prisma/V8_MIGRATION_NOTE.md`](./backend/prisma/V8_MIGRATION_NOTE.md)에 기록해 두었습니다.

### 5) 실행

```bash
docker compose up -d --build
```

- 웹 데모: http://localhost:3000 (역할별 데모 계정은 아래 표 참조)
- 백엔드 헬스체크: http://localhost:3001/health
- MCP 헬스체크: http://localhost:8000/health

### 👤 데모 계정 (역할별 로그인)

비밀번호는 공개 데모 값입니다. 로그인하면 역할에 맞는 화면으로 분기됩니다 (이슈 #11 — 간소화 RBAC).

| 계정 | 비밀번호 | 역할 | 로그인 후 화면 |
|---|---|---|---|
| `consultant@example.com` | `consult1234` | 영업·상담 담당자 | 상담 워크스페이스 홈(챗봇) `/` |
| `marketing@example.com` | `marketing1234` | 제품기획·마케팅 담당자 | 마케팅 화면(문구 검증·리서치) `/marketing` |
| `admin@example.com` | `admin1234` | 총관리자 | 관리 화면(접근 로그) `/admin` |
| `demo@example.com` | `demo1234` | 영업·상담 담당자 (구 데모 계정, 하위호환) | 상담 워크스페이스 홈 `/` |

> 고객 API(`/customers`)는 영업·상담 담당자(및 운영 확인용 총관리자)만 접근할 수 있고, 마케팅 담당자는 가드가 거부(403)합니다 (ADR-0001).

### 🧭 역할별 화면 구성 (Epic #2 확장)

| 화면 | 경로 | 접근 역할 | 기능 |
|---|---|---|---|
| 상담 워크스페이스 홈 | `/` | 상담·총관리자 | 도구 이동 허브 |
| 상담 챗봇 | `/chat` | 상담·총관리자 | 고객 선택 시 섭취 제품·성분·갭 컨텍스트 주입(#18) |
| 고객 목록·등록 | `/customers` | 상담·총관리자 | 고객 CRUD + 마스킹 목록(#13) |
| 고객 상세 | `/customers/:id` | 상담·총관리자 | 복호화 정보·섭취 제품 연결·성분 갭·추천 제안(#13~#17) |
| 마케팅 화면 | `/marketing` | 마케팅·총관리자 | 문구 검증(#19)·기능성·원료 리서치(#20) |
| 관리 화면 | `/admin` | 총관리자 | 접근 로그 열람(#14) |

### 🔎 데모 확인 절차 (두 브라우저/시크릿 조합)

역할이 다른 화면을 한 번에 비교하려면 계정이 분리된 두 세션이 필요합니다:

1. **크롬**: `consultant@example.com` / `consult1234` 로그인 → 고객 관리 → 고객 상세(성분 갭·추천 제안 확인)
2. **엣지·파이어폭스·크롬 시크릿창** 중 하나: `marketing@example.com` / `marketing1234` 로그인 → 마케팅 화면(문구 검증·리서치 확인 — 고객 메뉴가 보이지 않는 것도 포인트)
3. **세 번째 세션(선택)**: `admin@example.com` / `admin1234` → 관리 화면에서 접근 로그 열람 확인

> 시크릿탭 2개 조합도 동일하게 동작합니다(세션 쿠키·localStorage는 시크릿 창별로 분리됨).

## 🔑 MCP 토큰 사용법

MCP 서버는 `Authorization: Bearer <MCP_TOKEN>` 헤더를 요구합니다:

```bash
TOKEN=$(grep '^MCP_TOKEN=' .env | cut -d= -f2)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/health
```

MCP 도구 4종: `search_legal_provisions`, `get_functional_ingredient`, `get_product_report`, `get_notified_functionality`

## 🗺️ 구현 현황 (GitHub Issues)

- [x] #2 프로젝트 골격 및 Docker Compose 인프라 구성
- [x] #3 국가법령정보센터 법령 수집 및 legal_provisions 스키마 저장 (7종 398조문, 표시기준=administrative_rule, 참조 엣지 53건)
- [x] #4 법령 RAG 파이프라인 및 LangGraph 6단계 노드 구현 (359조문 임베딩·pgvector 검색·6단계 그래프 동작) — RAG 평가지표 스크립트는 #8에서
- [x] #5 식약처 기능성 정보 구조화 조회 및 total_count 증분 갱신 (5개 API 93,273건 적재)
- [x] #6 FastMCP 도구 노출 및 토큰 기반 인증 구현 (법령검색은 pgvector 벡터 검색 연동 완료)
- [x] #7 웹 데모: JWT 로그인·고객:성분 시딩(Prisma seed)·챗봇 (pgvector 근거 응답 + 각주 출처)
- [x] #8 RAG 평가 지표: `ingest/eval_rag.py` — Recall@5 1.000 / MRR 0.792 (8문항 골드셋)

Epic: https://github.com/RaeunYu/nutrition-mind/issues/1

## 🗂️ Obsidian Vault 운영 (AC12)

이 프로젝트의 결정 기록(ADR)과 회의록은 **단일 전역 Vault + symlink** 방식으로 관리합니다.
- 운영 방식·3계층 구조·QMD 최소 연동 설계: [`docs/obsidian-vault.md`](./docs/obsidian-vault.md)
- 요약: 프로젝트 Vault를 만들지 않고 `~/ObsidianVault/Projects/nutrition-mind/`에 symlink로 연결.
  Raw(원본) / Distilled(요약) / Decisions(ADR) 3계층 유지. QMD는 Raw가 500개 이상 쌓인 후 도입 검토(현 단계 미도입).


## 이 프로젝트를 만든 방식 — AI 에이전트 협업

이 저장소의 코드와 문서는 **Codex CLI**(에이전트 런타임, [@openai/codex](https://github.com/openai/codex)) 위에서 **Z.ai GLM(`glm-5.3-flash:cloud`)** 모델 에이전트와 사람의 협업으로 작성되었습니다. 사람은 요구사항 정의, 사용 기술스택 확정, 제반 인프라에 대한 스펙 조사(행정규칙 조회 경로, API 응답 스키마·응답 구조 등), 설계 피드백, 모든 변경사항에 대하여 확정 전 리뷰를 수행했고, 에이전트는 인터뷰 정리·설계·구현·문서화·이슈 검증을 담당했습니다.

작업 흐름은 **[Ouroboros](https://github.com/Q00/ouroboros)** 스펙 워크플로우를 따릅니다:

| 단계 | 이 프로젝트에서 한 일 |
|---|---|
| `ooo setup` + 스펙 인터뷰 | 배경 컨텍스트(`project-background-context.md`)를 반영해 미확정 사항만 질의 — 법령 범위, 기술 스택, LLM 운영 방식 등 확정 |
| `ooo seed` | 인터뷰 결과를 `seed.yaml`(골/제약/수용기준 13건)으로 산출 |
| `ooo publish` | Seed를 GitHub **Epic 1건 + Task 7건**으로 발행해 작업 추적 |
| `ooo run` | Task 단위 구현: 골격 → 법령 수집 → 식약처 적재 → 임베딩/RAG → 웹 데모 → 평가 |
| `ooo evaluate` | Task별 검증 결과를 이슈 코멘트로 기록 후 종료 처리 |

실제 개발 과정에서의 특이점:

- **API 실측 기반 구현**: 국가법령정보센터 본문 API의 `efYd` 필수 조건, 행정규칙 `target=admrul` 경로, 응답의 str/list 혼재 타입 등은 문서가 아닌 **호출 실측으로 발견**해 `project-background-context.md`에 기록했습니다.
- **도구 제약 → 수동 구현**: Ouroboros MCP 엔진이 세션 환경에서 호출 불가(CLI 없음)였기에, Seed 스펙·이슈를 기준으로 에이전트가 직접 구현하고 각 Task를 GitHub 이슈로 검증·종료했습니다.
- **폴백 우선 설계**: LLM 합성은 키/호출 실패 시 근거 나열로 폴백하며 사유를 응답에 표시 — 데모가 환경 의존 없이 동작하도록 함.
- **정량 검증**: 법령 398조문·식약처 93,273건 적재, RAG 평가 Recall@5 1.000 / MRR 0.792 (8문항 골드셋) — 구현 완료 판정을 수치로 남김.

## 📚 참고

- ⚠️ 식품안전나라 openapi는 **KST 09:00~19:00 호출 차단** (ERROR-503). 증분 갱신 잡은 19시 이후 실행. 상세 응답 코드는 [`foodsafetykorea_schema/api_response_schema_doc.md`](./foodsafetykorea_schema/api_response_schema_doc.md) 참고.

- 법령 참조 확장의 "관련/참고 3단 출처 구분"은 품질 개선 후보로 내부 문서에 기록 예정 (seed.yaml decisions)
- QMD는 초기 설계에 최소 연동만 포함, Graphify는 코드베이스 온보딩 전용 (비-목표: Neo4j, 소셜 로그인, 클라우드 배포)
