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
| `mcp` (Python FastMCP) | 8000 | MCP 도구 13종(법령·기능성 4 · 배송 3 · 주문·결제 3 · 고객·성분 3) |
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

## 🔑 MCP 도구 (13종)

| 카테고리 | 도구 |
|---|---|
| 법령·기능성 (4) | `search_legal_provisions` · `get_functional_ingredient` · `get_product_report` · `get_notified_functionality` |
| 배송 (3) | `list_customer_shipments` · `get_shipment_status` · `get_tracking_events` |
| 주문·결제 (3) | `list_customer_orders` · `get_order_detail` · `get_payment_status` |
| 고객·성분 (3) | `get_customer_profile` · `get_ingredient_gap` · `search_customers` |

각 도구는 MCP `_meta.category`(그리고 description 선두의 `[카테고리: …]`)로 카테고리를 노출합니다 — Epic #3의 도구 라우팅이 이 메타데이터로 카테고리별 도구를 고릅니다.

> **고객 데이터 도구는 접근 로그를 남깁니다**(ADR-0002 개정). 하네스가 보내는 `X-Actor-Email`/`X-Actor-Role` 헤더를 actor로 기록하고, Claude Desktop 같은 stdio 직접 호출은 `mcp-stdio`로 기록합니다. 접근 **기록**일 뿐 접근 **통제**가 아닙니다(아래 한계 절 참조).

Claude Desktop 연동(stdio)은 아래 [🖥️ Claude Desktop 연동](#️-claude-desktop-연동-stdio--권장) 섹션 참조 — 토큰 불필요.

### 🖥️ Claude Desktop 연동 (stdio — 권장)

Claude Desktop의 claude_desktop_config.json에서 원격 HTTP/SSE 설정은 **"유효한 MCP 서버 구성이 아님" 오류**가 발생할 수 있습니다(Claude Desktop은 원격 MCP를 Connectors UI로만 지원). 데모 테스트를 위한 가장 간단한 방법은 **stdio 트랜스포트로 호스트에서 직접 실행**하는 것입니다 — 네트워크 노출·헤더 인증이 불필요합니다.

**1. MCP 서버 venv 구성** — 호스트에서 직접 실행하기 위한 의존성을 설치합니다:

```bash
cd mcp-server
uv venv .venv && UV_CACHE_DIR=/tmp/uv-cache uv pip install -r requirements.txt python-dotenv
```

> uv가 없으면 `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt python-dotenv`로 대체할 수 있습니다.

**2. Claude Desktop 설정 편집** — `claude_desktop_config.json` 파일을 열어(Claude Desktop → Settings → Developer → Edit Config) `mcpServers`에 아래를 추가합니다:

```json
{
  "mcpServers": {
    "nutrition-mind": {
      "command": "/Users/yulaeun/nutrition-mind/mcp-server/.venv/bin/python",
      "args": ["/Users/yulaeun/nutrition-mind/mcp-server/run_stdio.py"]
    }
  }
}
```

> stdio는 HTTP 인증 미들웨어를 통과하지 않으므로 별도 토큰이 불필요합니다. 서버가 `.env`(프로젝트 루트)에서 `DATABASE_URL`(호스트 5433)·`OLLAMA_BASE_URL`을 자동 로드합니다.
> 경로는 절대 경로로 지정 — Claude Desktop이 `cwd`를 제어하지 않습니다. 프로젝트를 다른 경로에 클론한 경우 두 경로를 수정하세요.

**3. Claude Desktop 재시작** — 설정 저장 후 앱을 완전히 종료하고 재실행하면, 대화 입력창에 🔌 아이콘이 나타나며 도구 13종이 연결됩니다.

**4. 동작 확인** — Claude Desktop에서 "건강기능식품 영업 허가는 어떻게 받아?" 등의 질문을 입력해 법령 도구 호출이 발생하는지 확인합니다.

**5. 상거래·고객 도구 사용 (Epic #3)** — "김건강 고객 배송이 안 와요"처럼 입력하면 Claude가 `search_customers`로 고객을 찾고 `list_customer_shipments`·`get_shipment_status`로 배송 상태를 확인합니다. 데모용 배송 지연 데이터는 **김건강**(집화 후 5일 정체, 약속 배송일 경과)입니다.
> 고객 연락처·이메일·메모는 봉투 암호화되어 있고 MCP 서버는 복호화 키를 갖지 않으므로, 도구는 이름·주문·배송 정보만 반환합니다(개인정보 최소노출).

**고급: 원격 HTTP 연결** — Claude Desktop의 원격 MCP 연결은 Connectors UI로 지원됩니다. Docker HTTP 서버(`http://localhost:8000/mcp`)는 구동 중이며 stdio와 **동일한 13종**을 노출합니다. 원격 연결이 필요하면 `type: "http"`로 설정하고 SSE는 폐기된 전송 방식이므로 피하세요.

### ⚠️ 알려진 한계 — MCP 외부 접근에는 요청 단위 인증이 없습니다 (비목표)

웹 화면(`/chat`, `/customers`)은 JWT 로그인 뒤의 사내 담당자만 접근하지만, **MCP 서버는 Claude Desktop(stdio)과 HTTP(`localhost:8000/mcp`) 양쪽에 인증 없이 노출**됩니다. 즉 법령·기능성은 물론 **상거래·고객 도구까지 인증 없이 호출**할 수 있습니다.

- 실환경이라면 MCP 요청마다 별도 인증·권한 확인이 필요합니다. **현 구현 목표에서 의도적으로 제외한 비목표**이며 구현 누락이 아닙니다(ADR-0003 「비목표로 남긴 위험」).
- 접근 로그는 남지만 이는 **사후 기록이지 접근 통제가 아닙니다**(ADR-0002 개정).
- 후속 에픽에서 MCP 요청 단위 인증을 도입할 때 이 절과 ADR을 함께 갱신하세요.

## ✅ Epic 1 구현 현황 — 법령 RAG·MCP 데모 (이슈 #2~#8)

- [x] #3 국가법령정보센터 법령 수집 및 legal_provisions 스키마 저장 (7종 398조문, 표시기준=administrative_rule, 참조 엣지 53건)
- [x] #4 법령 RAG 파이프라인 및 LangGraph 6단계 노드 구현 (pgvector 검색·6단계 그래프 동작) — RAG 평가지표 스크립트는 #8에서
- [x] #5 식약처 기능성 정보 구조화 조회 및 total_count 증분 갱신 (5개 API 93,273건 적재)
- [x] #6 FastMCP 도구 노출 및 토큰 기반 인증 구현 (법령검색은 pgvector 벡터 검색 연동 완료)
- [x] #7 웹 데모: JWT 로그인·고객:성분 시딩(Prisma seed)·챗봇 (pgvector 근거 응답 + 각주 출처)
- [x] #8 RAG 평가 지표: `ingest/eval_rag.py` — Recall@5 1.000 / MRR 0.792 (8문항 골드셋)

Epic 1: https://github.com/RaeunYu/nutrition-mind/issues/1

### 🧩 Epic 2 — 담당자용 확장 (이슈 #10~#21 + 후속 #22·#23~#25·#26~#28·#29)

- [x] #10 법령 조문 본문 복원(P0): 조문+항·호 병합 재수집·재임베딩 — 본문 63,453→148,470자(+134%), 소실 66개 복원, 임베딩 426/426, RAG 평가 Recall@5 1.000 / MRR 0.792→**0.833**(13문항)
- [x] #11 역할별 로그인·간소화 RBAC: 3역할 가드·bcrypt 인증·로그인 페이지 분리
- [x] #12 품목제조신고 검색 기반: 정규화 칼럼 4종·91,992건 백필(멱등)·검색 API
- [x] #13 고객 관리·개인정보 보호: envelope encryption(KEK→DEK)·마스킹·가명 15명 시딩 — 연락처·이메일·메모 암호화(이름은 평문 전환: #28)
- [x] #14 접근 로그: 고객 상세 접근 기록·총관리자 열람 화면
- [x] #15 섭취 제품 등록: 품목제조신고 연결·수동 등록·제품 정보 스냅샷
- [x] #16 성분 마스터·성분 갭: 마스터 17종·원료명 키워드 규칙 매핑(tdd 24/24)·근거 표시
- [x] #17 성분 갭 기반 추천 제안: 갭→제품 매칭·근거 랭킹·수용/보류 절차(단위 10/10·통합 13/13)
- [x] #18 상담 보조 챗봇 개인화: 별도 페이지 분리·고객 컨텍스트 주입(테스트 11/11)
- [x] #19 마케팅 문구 검증: 표시기준·법령 근거 판정(허용/주의/금지/보류, 테스트 11/11)
- [x] #20 기능성·원료 리서치: 원료형 정규화·1일 섭취량·주의사항 노출(테스트 9/9)
- [x] #21 DESIGN.md 도구 UI 폴리시·README 데모 절차(디자인 토큰 `frontend/lib/design.ts`)
- [x] #22 참조 엣지 재추출: 가지번호 매칭 수정 — 엣지 233건(구 53건→), 가지번호 조문 54건 매칭

Epic 2: https://github.com/RaeunYu/nutrition-mind/issues/9

전체 회귀: 테스트 스크립트 16종 **222케이스 전부 통과**(Epic 3 이후).

### 🧩 Epic 3 — Tool Calling 루프와 Tool Routing/Selection (이슈 #32~#39)

에이전트 하네스(LLM ↔ 도구 실행 루프)와 도구 라우팅을 도입하고, 상담 담당자의 주문·결제·배송 문의를 실제 데이터로 답하게 했다. 결정 기록: [`docs/adr/0003`](./docs/adr/0003-상거래-도메인과-도구-호출-하네스.md) · 라우팅 평가: [`docs/tool-routing-eval.md`](./docs/tool-routing-eval.md)

- [x] #33 상거래 도메인: 주문·주문 항목·결제·배송·배송 이력 5엔터티, I0030 25종 제품 풀, 고객 20명·39주문, 시나리오 5종 + 부분배송(멱등 시드)
- [x] #34 MCP 도구 13종: 배송 3 · 주문·결제 3 · 고객·성분 3 · 법령·기능성 4, 카테고리 메타(`_meta.category`) + 접근 로그(actor 헤더/`mcp-stdio`)
- [x] #35 도구 카탈로그·실행 계층: `tools/list` 캐시·카테고리 그룹핑, `tools/call` 구조화 실행(타임아웃·오류), MCP 재시작 시 재연결
- [x] #36 도구 라우터 2기법: 임베딩 top-k **81.3%** / LLM 분류 **100%**, 복합 의도 top-2 병합 recall 87.5% / 100%
- [x] #37 에이전트 하네스 루프: 도구 스키마 주입 → `tool_calls` 실행 → 재호출(A 사전 주입 / B 동적 발견), 최대 3회·강제 합성, `routing`·`trace` 응답
- [x] #38 챗봇 UI: 도구 추적 패널 · A/B 토글 · 라우팅 방식 토글 · 지연 안내
- [ ] #39 검증·문서: 골드셋 사용자 검수 대기(그 외 완료)

**데모 — 도구 라우팅 확인 절차**
1. `consultant@example.com` / `consult1234` 로그인 → `/chat`
2. 고객에서 **김건강**(배송 지연 데모 데이터) 선택
3. 질문: "김건강 고객 배송이 안 와요"
4. `라우팅 방식`을 **임베딩**으로 두고 `도구 주입 방식`을 **A · 사전 주입** → 추적 패널에 `배송` 카테고리 선택 → 배송 도구 3종 주입 → `list_customer_shipments`·`get_shipment_status`·`get_tracking_events` 호출 → "ORD-0002 배송지연(약속일 대비 3일 지연, 물류센터 보관 5일)" 답변
5. 같은 질문을 **B · 동적 발견**으로 실행 → 첫 호출에 `list_tools`만 주입되고, LLM이 `list_tools(category="배송")`를 호출한 뒤 하네스가 배송 도구를 **재선언**하는 과정이 패널에 그대로 보인다
6. `라우팅 방식`을 **LLM 분류**로 바꿔 같은 질문을 실행하면 라우팅 방식만 달라지고 나머지 흐름은 동일하다

Epic 3: https://github.com/RaeunYu/nutrition-mind/issues/32

## 🗂️ Obsidian Vault 운영 (AC12)

이 프로젝트의 결정 기록(ADR)과 회의록은 **단일 전역 Vault + symlink** 방식으로 관리합니다.
- 운영 방식·3계층 구조·QMD 최소 연동 설계: [`docs/obsidian-vault.md`](./docs/obsidian-vault.md)
- 요약: 프로젝트 Vault를 만들지 않고 `~/ObsidianVault/Projects/nutrition-mind/`에 symlink로 연결.
  Raw(원본) / Distilled(요약) / Decisions(ADR) 3계층 유지. QMD는 Raw가 500개 이상 쌓인 후 도입 검토(현 단계 미도입).


## 이 프로젝트를 만든 방식 — AI 에이전트 협업

이 저장소의 코드와 문서는 에이전트 런타임 위에서 LLM 모델 에이전트와 사람의 협업으로 작성되었습니다. 사람은 요구사항 정의, 사용 기술스택 확정, 제반 인프라에 대한 스펙 조사(행정규칙 조회 경로, API 응답 스키마·응답 구조 등), 설계 피드백, 커밋 작업을 수행했고, 에이전트는 인터뷰 정리·설계·구현·문서화·이슈 검증을 담당했습니다.

### 1기: Ouroboros 스펙 워크플로우 (Epic #1 — 데모 구축)

프로젝트 초기에는 **Codex CLI** + **Z.ai GLM(`glm-5.3-flash:cloud`)** 모델 위에서 [Ouroboros](https://github.com/Q00/ouroboros) 스펙 워크플로우를 사용했습니다:

| 단계 | 이 프로젝트에서 한 일 |
|---|---|
| `ooo setup` + 스펙 인터뷰 | 배경 컨텍스트(`project-background-context.md`)를 반영해 미확정 사항만 질의 — 법령 범위, 기술 스택, LLM 운영 방식 등 확정 |
| `ooo seed` | 인터뷰 결과를 `seed.yaml`(골/제약/수용기준 13건)으로 산출 |
| `ooo publish` | Seed를 GitHub **Epic 1건 + Task 7건**으로 발행해 작업 추적 |
| `ooo run` | Task 단위 구현: 골격 → 법령 수집 → 식약처 적재 → 임베딩/RAG → 웹 데모 → 평가 |
| `ooo evaluate` | Task별 검증 결과를 이슈 코멘트로 기록 후 종료 처리 |

이 단계의 특이점: API 실측 기반 구현(법령 DRF `efYd` 필수 조건, 행정규칙 `target=admrul` 경로, str/list 혼재 타입 — 호출 실측으로 발견), 도구 제약 시 수동 구현 전환, 폴백 우선 설계, 정량 검증(Recall@5 1.000 / MRR 0.792).

### 2기: DeepSeek Harness + GLM-5.3-flash + mattpocock-skills (Epic #2 — 담당자용 확장)

Epic #1 종료 후 워크플로우를 전환했습니다. 전환 이유는 다음과 같습니다:

- **Ouroboros 사용 철회**: 고정된 목적으로 루프를 반복하며 개선을 시도하는 설계 자체는 좋았지만, 불필요한 커맨드 시도가 잦았습니다. 한 세션 안에서 샌드박스 정책으로 외부 네트워크·전역 경로 접근 불가를 이미 확인한 상태임에도, 이후 작업에서 권한 문제를 우회하려는 시도를 반복했습니다 — npm 레지스트리 폴더 통째 복제 시도, 쉘 로그인 계정 변경 시도까지 한 뒤에야 사용자에게 확인을 요청했습니다. 권한 확인을 먼저 하고 통과 시 작업하면 되는 일이었습니다.
- 설치된 여러 스킬 중 더 적합한 스킬이 있음에도 Ouroboros 프로젝트 내부에 정의된 스킬·에이전트를 우선 사용하는 경향이 있었습니다.
- 소크라테스식 인터뷰가 상세하지 않았고, 시드 파일도 누락된 부분이 많은 채 생성되었습니다(모델 영향도 있음).

변경 후 방식:

| 요소 | 운영 방식 |
|---|---|
| 티켓 진행 | ticket별로 진행하되, 병렬 실행 가능한 티켓은 **티켓별 서브에이전트로 전개해 백그라운드 실행** — 대화하는 에이전트는 오케스트레이터로 격상. 서브에이전트는 컨텍스트·세션이 분리되어 토큰 절약 |
| 감시·보고 | 전개된 에이전트를 감시·보고하는 과정을 라운드 스텝으로 쪼개 지속적 피드백 제공 — Codex 대비 시인성·선택 UI가 좋음 |
| 무진전 대응 | 서브에이전트가 여러 라운드에 걸쳐 피드백·진전이 없으면 작업을 신규 서브에이전트로 재위임(2~3회). 재위임 후에도 진전이 없으면 오케스트레이터가 직접 작업을 인수해 처리(컨텍스트는 더 쓰지만 확실함) |

실제 운영에서의 특이점:

- **서브에이전트 장기 무응답 → 재위임/인수**: 에이전트가 수십 분간 파일·DB·이슈 기록 없이 정체하면 중단 후 컨텍스트 유지 상태로 재개시켰고(1~2회), 재개 후에도 진전이 없으면 신규 에이전트로 교체하거나 오케스트레이터가 직접 구현으로 전환했습니다. 본 Epic에서 #16은 위임 성공, #13·#17은 재위임 후 오케스트레이터 인수로 완료했습니다.
- **커밋 정책 진화**: 초기에는 라운드 소모 방지를 위해 커밋을 사용자가 직접 수행(에이전트는 체크포인트에서 대기)했으나, 대기 중 라운드·컨텍스트 소모가 확인되어 말기에는 에이전트가 제안 커밋 메시지로 직접 커밋하는 방식으로 전환했습니다(push는 금지, repo git config author 사용).
- **데이터 유실 복구**: Prisma migrate 전환 중 `name_enc` DROP이 백필보다 먼저 적용돼 고객 이름이 유실됐으나, 성분 세트 매칭 + 검증 앵커(강시우·문가온)로 전원 복구했습니다.
- **정량 검증**: 법령 본문 복원(63,453→148,470자, 소실 66개 복원)·RAG 평가 Recall@5 1.000 / MRR 0.833(13문항 골드셋)·식약처 정규화 91,992건 백필·참조 엣지 233건(가지번호 매칭)·통합 테스트 11종 223케이스 — 구현 완료 판정을 수치로 남김.

### 아쉬운 점(개선 희망)

- 라운드 간 텀이 짧아 커밋 대기·장기 작업 관찰 중 라운드와 컨텍스트가 소모됐습니다. 라운드 간격 조절이 가능하면 좋겠습니다.
- 메인 오케스트레이터가 서브에이전트 응답 대기 중에는 pause 상태로 전환되지 않아(사용자와 서브에이전트 응답을 함께 대기) 라운드가 소모되는 구조가 아쉬웠습니다.

## 📚 참고

- ⚠️ 식품안전나라 openapi는 **KST 09:00~19:00 호출 차단** (ERROR-503). 증분 갱신 잡은 19시 이후 실행. 상세 응답 코드는 [`foodsafetykorea_schema/api_response_schema_doc.md`](./foodsafetykorea_schema/api_response_schema_doc.md) 참고.

- 법령 참조 확장의 "관련/참고 3단 출처 구분"은 품질 개선 후보로 내부 문서에 기록 예정 (seed.yaml decisions)
- QMD는 초기 설계에 최소 연동만 포함, Graphify는 코드베이스 온보딩 전용 (비-목표: Neo4j, 소셜 로그인, 클라우드 배포)
