"""국가법령정보센터 법령 수집기 (Task #3 — AC2, AC3).

대상 법령 7종(project-background-context.md 1장):
  법률 2 + 시행령 2 + 시행규칙 2 + 행정규칙(표시기준) 1
조문 단위로 파싱해 legal_provisions 저장, 위임/인용 엣지는 provision_references로 저장.
시행 예정 조문: 본문의 [시행일: YYYY. M. D.] 마커 → effective_date.

사용법:
  python law_collector.py --mst "건강기능식품에관한법률" --law-type law
  python law_collector.py --mst "건강기능식품에관한법률 시행령" --law-type enforcement_decree
  python law_collector.py --mst "건강기능식품의표시기준" --law-type administrative_rule
"""
import argparse
import os
import re
import sys
from datetime import date

import psycopg
import requests
from dotenv import load_dotenv

BASE = "http://apis.data.go.kr/1170000/lawService"
SYSED_MARK = re.compile(r"^\[시행일:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\]\s*", re.M)
ARTICLE_RE = re.compile(r"^제(\d+조(?:의\d+)?)\s*\(([^)]*)\)", re.M)


def parse_effective_date(content: str) -> date | None:
    m = SYSED_MARK.search(content or "")
    if not m:
        return None
    y, mo, d = (int(x) for x in m.groups())
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def strip_effective_marker(content: str) -> str:
    return SYSED_MARK.sub("", content or "")


def fetch_xml(api_key: str, mst: str) -> bytes:
    """국가법령정보센터 상세표재(원문 XML) 조회: serviceId=lawDetail."""
    url = f"https://open.law.go.kr/LSO/openApi/guideLsJoPrc.do"
    params = {"serviceId": "lawDetail", "MST": mst, "gosiType": "", "OSID": ""}
    headers = {"Accept": "application/xml"}
    res = requests.get(url, params=params, headers=headers, timeout=30)
    res.raise_for_status()
    return res.content


def parse_articles(xml: bytes) -> list[dict]:
    """상세표재 XML에서 조문(제N조) 단위 분리.

    XML 구조: <lawService> <l> ... <basic> ... <joInfo> ...
    조문은 <jo> 엘리먼트(조번호/조제목/조본문) 단위로 제공되므로 ElementTree로 파싱.
    """
    import xml.etree.ElementTree as ET
    root = ET.fromstring(xml)
    articles: list[dict] = []

    # 조문 정보는 레이아웃에 따라 jo 또는 joInfo 등으로 오므로 느슨하게 탐색
    for elem in root.iter():
        tag = elem.tag.lower()
        if tag in ("jo", "jo_info", "article"):
            art_no = None
            art_title = None
            content = None
            for child in elem.iter():
                ctag = child.tag.lower()
                text = (child.text or "").strip()
                if ctag in ("jo_no", "num", "article_no") and text:
                    art_no = text
                elif ctag in ("jo_title", "subject", "article_title") and text:
                    art_title = text
                elif ctag in ("jo_content", "content", "article_body", "basic") and text:
                    content = text
            if not art_no and content:
                m = ARTICLE_RE.search(content)
                if m:
                    art_no = m.group(1)
                    if not art_title:
                        art_title = m.group(2).strip()
            if art_no and content:
                articles.append({
                    "article_no": art_no,
                    "article_title": art_title or "",
                    "content": content.strip(),
                })
    # 중복 제거(조문 번호 기준)
    seen = set()
    unique = []
    for a in articles:
        if a["article_no"] in seen:
            continue
        seen.add(a["article_no"])
        unique.append(a)
    return unique


def save(law_name: str, law_type: str, articles: list[dict]) -> int:
    db_url = os.environ.get(
        "DATABASE_URL", "postgresql://nutrition:nutrition_dev_pw@localhost:5432/nutrition_mind"
    )
    saved = 0
    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        for a in articles:
            eff = parse_effective_date(a["content"])
            body = strip_effective_marker(a["content"])
            cur.execute(
                """INSERT INTO legal_provisions
                     (law_name, law_type, article_no, article_title, content, effective_date)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (law_name, article_no) DO UPDATE
                     SET article_title = EXCLUDED.article_title,
                         content = EXCLUDED.content,
                         effective_date = EXCLUDED.effective_date""",
                (law_name, law_type, a["article_no"], a["article_title"], body, eff),
            )
            saved += 1
    return saved


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mst", required=True, help="법령 MST 또는 법령명")
    ap.add_argument("--name", required=True, help="legal_provisions.law_name 값")
    ap.add_argument("--law-type", required=True, choices=[
        "law", "enforcement_decree", "enforcement_rule", "administrative_rule", "referenced_external"])
    ap.add_argument("--xml-file", help="API 미사용 시 로컬 XML로 테스트")
    args = ap.parse_args()
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

    if args.xml_file:
        with open(args.xml_file, "rb") as f:
            xml = f.read()
    else:
        api_key = os.environ.get("LAW_OPEN_API_KEY", "")
        if not api_key:
            sys.exit("❌ LAW_OPEN_API_KEY가 .env에 없습니다. 발급 후 .env에 입력하세요.")
        xml = fetch_xml(api_key, args.mst)

    articles = parse_articles(xml)
    if not articles:
        sys.exit("❌ 조문 파싱 실패 — XML 구조 확인 필요")
    saved = save(args.name, args.law_type, articles)
    print(f"✅ [{args.name}] {saved}조문 저장 완료 (law_type={args.law_type})")


if __name__ == "__main__":
    main()
