# 이슈 트래커: GitHub

이 저장소의 이슈와 스펙은 GitHub 이슈로 관리한다. 모든 조작은 `gh` CLI를 사용한다.

## 규칙

- **이슈 생성**: `gh issue create --title "..." --body "..."`. 여러 줄 본문은 heredoc을 사용한다.
- **이슈 읽기**: `gh issue view <number> --comments` — 코멘트는 `jq`로 필터링하고, 라벨도 함께 가져온다.
- **이슈 목록**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` — 필요에 따라 `--label`, `--state` 필터를 붙인다.
- **이슈 코멘트**: `gh issue comment <number> --body "..."`
- **라벨 적용/제거**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **종료**: `gh issue close <number> --comment "..."`

저장소는 `git remote -v`에서 추론한다. 클론 안에서 실행하면 `gh`가 자동으로 인식한다.

## PR을 트리아지 서피스로 사용

**PR을 요청 서피스로 사용: 아니오.** _(이 저장소가 외부 PR을 기능 요청으로 취급하게 하려면 `yes`로 변경. `/triage`가 이 플래그를 읽는다.)_

`yes`일 때는 PR도 이슈와 동일한 라벨·상태 체계를 따르며, `gh pr` 명령어 대응판을 사용한다:

- **PR 읽기**: `gh pr view <number> --comments`, diff는 `gh pr diff <number>`.
- **트리아지 대상 외부 PR 목록**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`를 실행한 뒤 `authorAssociation`이 `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `NONE`인 것만 남긴다 (`OWNER`/`MEMBER`/`COLLABORATOR`는 제외).
- **코멘트/라벨/종료**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub은 이슈와 PR이 하나의 번호 공간을 공유하므로 `#42`는 어느 쪽일 수 있다: `gh pr view 42`로 먼저 확인하고, 안 되면 `gh issue view 42`.

## 스킬이 "publish to the issue tracker"라고 할 때

GitHub 이슈를 생성한다.

## 스킬이 "fetch the relevant ticket"이라고 할 때

`gh issue view <number> --comments`를 실행한다.

## Wayfinder 운영

`/wayfinder`가 사용한다. **맵**은 단일 이슈이고, **자식** 이슈가 티켓이다.

- **맵**: `wayfinder:map` 라벨을 단 이슈 하나로, Notes / Decisions-so-far / Fog 본문을 담는다. `gh issue create --label wayfinder:map`.
- **자식 티켓**: 맵에 GitHub sub-issue로 연결된 이슈. sub-issue를 못 쓰는 환경에서는 맵 본문의 태스크 목록에 자식을 추가하고, 자식 본문 상단에 `Part of #<map>`을 둔다. 라벨: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). 클레임되면 작업을 진행하는 개발자에게 할당한다.
- **블로킹**: GitHub **네이티브 이슈 의존성**을 정식 표현으로 사용한다. 엣지 추가: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` — `<blocker-db-id>`는 블로커의 숫자 **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`로 조회, `#number`나 `node_id`가 아님). GitHub은 `issue_dependencies_summary.blocked_by`(열린 블로커만, 실시간 게이트)를 보고한다. 의존성을 못 쓰는 환경에서는 자식 본문 상단의 `Blocked by: #<n>, #<n>` 줄로 대체한다. 블로커가 전부 닫히면 티켓이 언블록된다.
- **프론티어 조회**: 맵의 열린 자식을 나열(`gh issue list --state open`, 맵의 sub-issue/태스크 목록으로 범위 제한)하고, 열린 블로커가 있거나(`issue_dependencies_summary.blocked_by > 0`, 또는 `Blocked by` 줄에 열린 이슈) 담당자가 있는 항목은 제외한다. 맵 순서상 첫 항목이 승자.
- **클레임**: `gh issue edit <n> --add-assignee @me` — 세션의 첫 쓰기.
- **해결**: `gh issue comment <n> --body "<answer>"`, 이어서 `gh issue close <n>`, 그리고 맵의 Decisions-so-far에 컨텍스트 포인터(gist + 링크)를 추가한다.