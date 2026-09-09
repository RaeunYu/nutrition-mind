"""국가법령정보센터 DRF API 기반 법령 수집기 (Task #3 — AC2, AC3).

대상 법령 7종(project-background-context.md 1장):
  법률 2 + 시행령 2 + 시행규칙 2 + 행정규칙(표시기준) 1

API 구조 실측 기준(2026-09):
  1. 검색: GET https://www.law.go.kr/DRF/lawSearch.do
     params: OC=<키>, target=law, type=JSON, search=1(법령명 검색), query=<법령명>
     응답: LawSearch.law — 1건일 때 dict, N건일 때 list → 정규화 필요
     정확매칭: 법령명한글 == 검색어 && 현행연혁코드 == '현행'
  2. 본문: GET https://www.law.go.kr/DRF/lawService.do
     params: OC=<키>, target=law, MST=<법령일련번호>, type=JSON (efYd는 상세링크에 있으면 포함)
     응답: 법령.기본정보 / 법령.조문.조문단위[] / 법령.부칙.부칙단위[]
     조문단위: 조문번호/조문여부(조문|전문|항|호)/조문제목/조문내용/조문시행일자

주의: 본문 API의 ID/MST 매핑은 efYd(시행일)를 함께 넘겨야 현행본문이 나옴.
      검색 응답의 법령상세링크에 efYd가 포함되므로 그 값을 재사용.

사용법:
  python law_collector.py --target-laws      # 7종 전체 수집
  python law_collector.py --mst 267803 --name "건강기능식품에 관한 법률 시행령" --law-type enforcement_decree
  python law_collector.py --mst 261635 --name "건강기능식품의표시기준" --law-type administrative_rule
"""
import argparse
import json
import os
import re
import sys
from datetime import date

import psycopg
import requests
from dotenv import load_dotenv

SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do"
DETAIL_URL = "https://www.law.go.kr/DRF/lawService.do"

# (law_name, law_type, 검색어 후보) — 표시기준은 행정규칙(고시)이라 DRF 대상이 별개일 수 있어 별도 처리
TARGET_LAWS = [
    ("건강기능식품에 관한 법률", "law"),
    ("건강기능식품에 관한 법률 시행령", "enforcement_decree"),
    ("건강기능식품에 관한 법률 시행규칙", "enforcement_rule"),
    ("식품 등의 표시ㆍ광고에 관한 법률", "law"),
    ("식품 등의 표시ㆍ광고에 관한 법률 시행령", "enforcement_decree"),
    ("식품 등의 표시ㆍ광고에 관한 법률 시행규칙", "enforcement_rule"),
    ("건강기능식품의 표시기준", "administrative_rule"),  # 행정규칙(고시) — target=admrul
]


def _normalize_laws(laws) -> list[dict]:
    if isinstance(laws, dict):
        laws = [laws]
    return [l for l in laws if isinstance(l, dict)]


def search_mst(key: str, query: str, target: str = "law") -> tuple[str | None, str | None]:
    """법령/행정규칙 검색 → 정확매칭 현행 일련번호. 상세링크(efYd 포함)도 반환.

    target=law: 응답 LawSearch.law (search=1 법령명 검색)
    target=admrul: 응답 AdmRulSearch.admrul (행정규칙일련번호 사용)
    """
    if target == "admrul":
        r = requests.get(SEARCH_URL, params={
            "OC": key, "target": "admrul", "type": "JSON", "query": query,
        }, timeout=30)
        rules = r.json().get("AdmRulSearch", {}).get("admrul", [])
        rules = _normalize_laws(rules)
        for rule in rules:
            if rule.get("행정규칙명") == query and rule.get("현행연혁구분") == "현행":
                return rule.get("행정규칙일련번호"), rule.get("행정규칙상세링크", "")
        return None, None

    r = requests.get(SEARCH_URL, params={
        "OC": key, "target": "law", "type": "JSON", "search": 1, "query": query,
    }, timeout=30)
    laws = _normalize_laws(r.json().get("LawSearch", {}).get("law", []))
    for l in laws:
        if l.get("법령명한글") == query and l.get("현행연혁코드") == "현행":
            return l.get("법령일련번호"), l.get("법령상세링크", "")
    return None, None


def efYd_from_link(link: str) -> str | None:
    m = re.search(r"efYd=(\d{8})", link or "")
    return m.group(1) if m else None


def fetch_detail(key: str, mst: str, link: str | None = None, target: str = "law") -> dict:
    """법령/행정규칙 본문 JSON 조회.

    target=law: 법령.조문.조문단위[] 구조, MST 인자, efYd(상세링크 값 우선)
    target=admrul: AdmRulService.조문내용(list[str]) 구조, ID 인자
    """
    if target == "admrul":
        r = requests.get(DETAIL_URL, params={
            "OC": key, "target": "admrul", "type": "JSON", "ID": mst,
        }, timeout=30)
        r.raise_for_status()
        svc = r.json().get("AdmRulService", {})
        return {"_kind": "admrul", "service": svc}

    params = {"OC": key, "target": "law", "MST": mst, "type": "JSON"}
    if link:
        ef = efYd_from_link(link)
        if ef:
            params["efYd"] = ef
    r = requests.get(DETAIL_URL, params=params, timeout=30)
    r.raise_for_status()
    d = r.json()
    law = d.get("법령") or d.get("Law") or {}
    if not isinstance(law, dict) or not law:
        raise ValueError(f"법령 본문 조회 실패: MST={mst}")
    return law



def _flatten(x) -> str:
    """DRF 응답의 내용 필드는 str | list[str] | 중첩 list 형태 → 문자열 정규화(재귀).

    중첩 list(예: 부칙단위.부칙내용=[[...]])를 str()로 직렬화하면 Python repr 문자열이
    그대로 저장되는 결함(이슈 #10)을 피하기 위해 재귀적으로 풀어 연결한다.
    """
    if x is None:
        return ""
    if isinstance(x, list):
        parts = [_flatten(i) for i in x]
        return "\n".join(p for p in parts if p)
    return str(x).strip()


def _hang_lines(hang) -> list[str]:
    """조문단위.항을 본문 라인(list[str])으로 정규화. DRF 변이 실측(2026-09):

    - 다중 항: list[dict] — 각 dict는 항번호/항내용, 호가 있으면 호(list[dict])
    - 단일 항: dict 축소형 — 항내용 없이 {"호": [...]}만 있고 항 본문은 조문내용(도입문)에 포함
    - 항내용/호내용은 "①", "1." 접두어가 원문에 포함되어 있으므로 재구성하지 않는다.
      (호가지번호 "의2"도 호내용에 "1의2." 접두어로 포함됨)
    """
    items = [hang] if isinstance(hang, dict) else (hang or [])
    lines: list[str] = []
    for h in items:
        if isinstance(h, dict):
            body = _flatten(h.get("항내용"))
            if body:
                lines.append(body)
            for g in h.get("호") or []:
                gb = _flatten(g.get("호내용")) if isinstance(g, dict) else _flatten(g)
                if gb:
                    lines.append(gb)
        else:
            s = _flatten(h)
            if s:
                lines.append(s)
    return lines


ARTICLE_HEAD_RE = re.compile(r"^제(\d+조(?:의\d+)?)(?:\(([^)]*)\))?")


def iter_articles(law: dict):
    """조문단위 + 부칙단위를 (번호, 제목, 내용, 조문시행일자)로 산출. 조문 1개=청크 1개.

    결함 수정(이슈 #10, API 실측 2026-09 기준):
    - 항·호 본문은 조문단위 내부 `항`/`항[].호`에 중첩되어 있고 최상위 조문내용에는
      조문 제목(+도입문)만 담겨 있다. 기존 구현은 조문내용만 저장해 본문이 누락됨
      → 항내용·호내용을 조문 content에 병합한다(조문 1개=청크 1개 유지).
    - 조문가지번호(제N조의2)가 본조문과 같은 조문번호를 공유하고, 장/절 제목 단위
      (조문여부=전문)도 조문번호를 공유해 (law_name, article_no) 충돌로 덮어써짐
      → article_no를 "N의M" 형식으로 고유화하고, 조문여부=전문 단위는 제외한다.
    """
    if law.get("_kind") == "admrul":
        jo_list = law.get("service", {}).get("조문내용", []) or []
        for txt in jo_list:
            txt = _flatten(txt)
            m = ARTICLE_HEAD_RE.match(txt)
            if m:
                yield {
                    "article_no": f"제{m.group(1)}",
                    "article_title": (m.group(2) or "").strip() or None,
                    "content": txt,
                    "effective": None,
                }
        return

    jo = law.get("조문", {}) or {}
    for u in jo.get("조문단위", []) or []:
        if (u.get("조문여부") or "조문") != "조문":
            continue  # 전문(장/절 제목) 등 조문 아닌 단위 — 조문번호 충돌 원천
        no = str(u.get("조문번호") or "").strip()
        if u.get("조문가지번호"):
            no = f"{no}의{str(u['조문가지번호']).strip()}"
        head = _flatten(u.get("조문내용"))
        body = _hang_lines(u.get("항"))
        content = "\n".join(x for x in (head, *body) if x)
        yield {
            "article_no": no,
            "article_title": _flatten(u.get("조문제목")) or None,
            "content": content,
            "effective": u.get("조문시행일자"),
        }
    bc = law.get("부칙", {}) or {}
    bu = bc.get("부칙단위", []) or []
    # 동일 공포일자 부칙이 여러 개면 공포번호를 붙여 article_no 충돌을 피한다
    date_counts: dict[str, int] = {}
    for u in bu:
        d = str(u.get("부칙공포일자") or "")
        date_counts[d] = date_counts.get(d, 0) + 1
    for u in bu:
        d = str(u.get("부칙공포일자") or "")
        no = f"부칙 {d}"
        if date_counts.get(d, 0) > 1 and u.get("부칙공포번호"):
            no = f"{no}_{str(u.get('부칙공포번호')).strip()}"
        yield {
            "article_no": no,
            "article_title": u.get("부칙제목") or "부칙",
            "content": _flatten(u.get("부칙내용")),
            "effective": u.get("부칙시행일자"),
        }


def save(law_name: str, law_type: str, articles: list[dict]) -> int:
    db_url = os.environ.get(
        "DATABASE_URL", "postgresql://nutrition:nutrition_dev_pw@localhost:5433/nutrition_mind"
    )
    saved = 0
    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        for a in articles:
            eff = a.get("effective")
            eff_date = None
            if eff and re.fullmatch(r"\d{8}", str(eff)):
                s = str(eff)
                eff_date = date(int(s[:4]), int(s[4:6]), int(s[6:8]))
            cur.execute(
                """INSERT INTO legal_provisions
                     (law_name, law_type, article_no, article_title, content, effective_date)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (law_name, article_no) DO UPDATE
                     SET article_title = EXCLUDED.article_title,
                         content = EXCLUDED.content,
                         effective_date = EXCLUDED.effective_date,
                         -- 본문이 바뀌었으므로 기존 임베딩은 무효화(재임베딩 대상)
                         embedding = NULL""",
                (law_name, law_type, a["article_no"], a["article_title"], a["content"], eff_date),
            )
            saved += 1
        # 재수집 동기화: 이번 수집에 없는 구(舊) 행은 삭제(전문·중복 행 잔존 방지)
        # — 참조로 수집된 외부 조문(referenced_external)은 다른 경로 산출물이므로 제외 대상 아님
        nos = [a["article_no"] for a in articles]
        cur.execute(
            """DELETE FROM legal_provisions
                WHERE law_name = %s AND law_type = %s
                  AND article_no <> ALL(%s::text[])""",
            (law_name, law_type, nos),
        )
    return saved


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="대상 법령 6종(DRF) 전체 수집")
    ap.add_argument("--mst", help="단일 법령 MST")
    ap.add_argument("--name", help="legal_provisions.law_name 값")
    ap.add_argument("--law-type", choices=["law", "enforcement_decree", "enforcement_rule",
                                           "administrative_rule", "referenced_external"])
    args = ap.parse_args()
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    key = re.sub(r"\s+", "", os.environ.get("LAW_OPEN_API_KEY", "").strip())
    if not key:
        sys.exit("❌ LAW_OPEN_API_KEY가 .env에 없습니다.")

    if args.all:
        total = 0
        for name, law_type in TARGET_LAWS:
            target = "admrul" if law_type == "administrative_rule" else "law"
            mst, link = search_mst(key, name, target=target)
            if not mst:
                print(f"⚠️  미발견: {name}")
                continue
            law = fetch_detail(key, mst, link, target=target)
            arts = [a for a in iter_articles(law) if a["article_no"] and a["content"]]
            saved = save(name, law_type, arts)
            total += saved
            print(f"✅ {name} → {saved}조문 (law_type={law_type})")
        print(f"합계: {total}조문")
    elif args.mst and args.name and args.law_type:
        law = fetch_detail(key, args.mst)
        arts = [a for a in iter_articles(law) if a["article_no"] and a["content"]]
        saved = save(args.name, args.law_type, arts)
        print(f"✅ {args.name} → {saved}조문")
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
