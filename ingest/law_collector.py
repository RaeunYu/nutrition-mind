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
    """DRF 응답의 내용 필드는 str 또는 list[str] 형태 → 문자열 정규화."""
    if x is None:
        return ""
    if isinstance(x, list):
        return "\n".join(str(i).strip() for i in x if str(i).strip())
    return str(x).strip()

ARTICLE_HEAD_RE = re.compile(r"^제(\d+조(?:의\d+)?)(?:\(([^)]*)\))?")


def iter_articles(law: dict):
    """조문단위 + 부칙단위를 (번호, 제목, 내용, 조문시행일자)로 산출. 조문 1개=청크 1개."""
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
        yield {
            "article_no": str(u.get("조문번호") or "").strip(),
            "article_title": _flatten(u.get("조문제목")) or None,
            "content": _flatten(u.get("조문내용")),
            "effective": u.get("조문시행일자"),
        }
    bc = law.get("부칙", {}) or {}
    for u in bc.get("부칙단위", []) or []:
        yield {
            "article_no": f"부칙 {u.get('부칙공포일자', '')}",
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
                         effective_date = EXCLUDED.effective_date""",
                (law_name, law_type, a["article_no"], a["article_title"], a["content"], eff_date),
            )
            saved += 1
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
