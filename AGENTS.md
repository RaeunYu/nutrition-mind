# AGENTS.md — nutrition-mind

건강기능식품 법령·기능성 정보 RAG·MCP 데모 (로컬 Docker Compose 포트폴리오).

## 참조 문서 (작업 주제에 해당하는 것만 읽는다)

- `README.md` — 서비스 구성·실행법, 구현 현황 체크리스트
- `seed.yaml` — 1차 스펙(Goal/제약/수용기준). 갱신·예외는 `docs/adr/` 기록 우선
- `project-background-context.md` — 배경 컨텍스트 + 외부 API 실측 기록(호출 제약·필수 파라미터)
- `HANDOFF-2026-09-09.md` — 직전 에이전트 인수인계(환경 제약, Docker/Ollama/포트 운영 상수)
- `docs/obsidian-vault.md` — ADR 양식(3절) + Vault 운영

## 운영 규칙 (불변)

- 모든 문서·UI 문구·CLI 안내는 한국어로 작성한다.
- 커밋·푸시는 사용자 승인 후에만 수행한다.
- `.env`의 API 키 값을 출력·복사하지 않는다.

## Agent skills

### Issue tracker

이슈는 GitHub Issues에서 관리하며 `gh` CLI로 읽고 쓴다. 자세한 운영 규칙은 `docs/agents/issue-tracker.md`.

### Triage labels

기본 5종 라벨(needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix)을 그대로 사용한다. 매핑 테이블은 `docs/agents/triage-labels.md`.

### Domain docs

single-context: 루트 `CONTEXT.md`(용어집, 지연 생성) + `docs/adr/`(결정 기록). 소비 규칙은 `docs/agents/domain.md`.