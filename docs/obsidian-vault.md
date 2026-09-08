# Obsidian Vault 운영 방식 — nutrition-mind

> 이 문서는 `project-background-context.md` 3장의 설계 방향을 본 프로젝트에 적용한 **확정 운영 방식**입니다 (AC12).
> QMD(검색 효율화 도구)의 최소 연동 설계도 하단에 포함되어 있습니다.

## 1. Vault 배치 결정: 단일 전역 Vault + symlink (배경 문서 3장 대안 1 채택)

**결정**: 프로젝트 안에 독립 Vault를 두지 않고, **단일 전역 Vault** 하위에 프로젝트 폴더를 연결하는 구조를 사용합니다.

```
~/ObsidianVault/                      ← 유일한 Vault (전역)
├── Projects/
│   └── nutrition-mind/               ← 프로젝트 메타 노트 위치
│       ├── 프로젝트 개요.md
│       ├── 스프린트 요약.md           (Layer 2 — 사람이 요약)
│       └── ...
├── Decisions/                        ← Layer 3 — ADR (영구 지식)
│   ├── 001-prisma-v7-고정.md
│   ├── 002-행정규칙-admrul-경로.md
│   └── ...
└── Raw/                              ← Layer 1 — 원본 아카이브 (거의 손 안 댐)
    └── 2026-09/...

/Users/yulaeun/nutrition-mind/docs/    ← 실제 파일은 프로젝트 저장소에 존재 (git 관리)
└── obsidian-vault.md                 ← 이 문서
```

전역 Vault 안에서 다음과 같이 symlink로 연결합니다:

```bash
ln -s /Users/yulaeun/nutrition-mind/docs ~/ObsidianVault/Projects/nutrition-mind/docs
```

**이유** (배경 문서 3.1절 근거):
- Vault 간 위키링크/그래프는 경계를 넘지 못함 → Vault가 하나여야 링크·그래프가 연결됨
- `.obsidian` 설정이 프로젝트 git에 섞이는 것을 방지 (`.obsidian`은 전역 Vault에만 존재)
- 실제 파일은 프로젝트 저장소에 있으므로 git 버전관리 유지

## 2. 코딩 에이전트 연동 규칙

에이전트는 Vault 개념을 모르므로, 아래 규칙을 프롬프트/설정에 **명시적으로** 포함해야 합니다 (배경 문서 3.1절).

1. **프로젝트 내 문서 우선**: 에이전트는 `/Users/yulaeun/nutrition-mind/docs/` 아래를 먼저 검색합니다.
2. **전역 Vault 참조가 필요한 경우**: `~/ObsidianVault/Decisions/`의 ADR을 참조해야 하면,
   사용자가 경로를 알려주거나 아래 MCP 연동을 사용합니다.
3. **설정 파일 명시 예시** (`CLAUDE.md` 등에 기록):
   ```markdown
   ## Obsidian Vault
   전역 Vault 경로: ~/ObsidianVault
   - 프로젝트 ADR: ~/ObsidianVault/Decisions/
   - 프로젝트 메타 노트: ~/ObsidianVault/Projects/nutrition-mind/
   ```

## 3. 3계층 아카이빙 구조 (배경 문서 3.2절 채택)

| Layer | 위치 | 내용 | 관리 방식 |
|---|---|---|---|
| **Layer 1 — Raw** | `~/ObsidianVault/Raw/YYYY-MM/` | 회의록·이슈 export 원본 | 기계적 적재, 손 안 댐 |
| **Layer 2 — Distilled** | `~/ObsidianVault/Projects/nutrition-mind/` | 주간/스프린트 결정 3~5줄 요약 | 사람이 작성, Raw 링크 |
| **Layer 3 — Decisions** | `~/ObsidianVault/Decisions/` | ADR (아키텍처 결정 기록) | 영구 보존, 검색 대상 |

- **삭제/콜드아카이브 금지** — 근거 추적이 단절되므로, 오래된 Raw는 Obsidian "Excluded files" 설정으로 검색 인덱스에서만 제외
- 노이즈 방지가 목적이므로 Layer 2 요약이 실제 검색·그래프의 주 대상

### ADR 예시 — 이미 확정된 결정의 ADR화

이 프로젝트에서 이미 확정된 결정은 아래와 같이 ADR로 변환해 Vault에 기록합니다:

```markdown
# 001 — Prisma v7 고정

- 날짜: 2026-09-08
- 상태: 확정
- 맥락: ORM 선택 시 v8이 RC 상태로 불확실성이 큼
- 결정: Prisma v7.10.0 고정
- 근거: backend/prisma/V8_MIGRATION_NOTE.md 체크리스트 참조
- 대안: v8 RC (변경점 많아 보류), Drizzle (학습 목적 대비 자료 적음)
```

## 4. QMD 최소 연동 설계 (AC12)

**QMD**([`tobi/qmd`](https://github.com/tobi/qmd)): BM25 + 벡터 + LLM 재랭킹 하이브리드 검색을 제공하는 MCP 서버. Vault 검색 효율화 후보.

### 도입 시점 원칙 (seed.yaml 제약 반영)
- **지금은 도입하지 않음** — Raw 노트가 문제가 될 만큼 쌓인 이후 검토
- **트리거 조건**: Layer 1 Raw 노트가 500개 이상 쌓이고, Layer 2 요약으로도 원하는 노트를 못 찾는 경우
- **범위 제한**: QMD는 **어디까지나 Vault(회의록·노트) 검색 전용**이며, 이 프로젝트의 법령/기능성 RAG(pgvector)와는 **완전히 별개 트랙** (seed.yaml: "Graphify를 법령 도메인 그래프에 사용하지 않음"과 동일한 분리 원칙)

### 최소 연동 설계 (도입 시점에 실행)

1. **설치/실행**: QMD MCP 서버를 전역 Vault 경로(`~/ObsidianVault`)에 설정
2. **연결 방식**: Codex/Claude Code의 MCP 설정에 추가 — 프로젝트 설정이 아니라 사용자 전역 설정으로 (Vault가 전역 자원이므로)
3. **에이전트 지시문** (프로젝트 `CLAUDE.md`에 기록):
   ```markdown
   ## Vault 검색 (QMD)
   - Obsidian Vault 검색이 필요하면 QMD MCP 도구 사용
   - 프로젝트 코드/문서 검색은 QMD가 아니라 로컬 파일 도구 사용 (역할 분리)
   ```
4. **불변 규칙**: QMD 인덱스 대상에 프로젝트 소스코드/법령 DB를 포함하지 않음

## 5. 운영 체크리스트

- [ ] 전역 Vault 생성: `mkdir -p ~/ObsidianVault/{Projects/nutrition-mind,Decisions,Raw/2026-09}`
- [ ] symlink 연결: `ln -s .../docs ~/ObsidianVault/Projects/nutrition-mind/docs`
- [ ] 확정 결정 ADR화: Prisma v7 고정, admrul 경로, 5433 포트 등 → `Decisions/`
- [ ] (QMD 도입 시점) MCP 설정 + CLAUDE.md 지시문 추가
