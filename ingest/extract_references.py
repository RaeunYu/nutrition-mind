"""조문 참조 엣지 추출 (Task #3 — AC2: provision_references).

규칙:
- 위임: "대통령령으로 정한다" / "총리령으로 정한다" / "부령으로 정한다" → delegates_to
  (위임 대상 법령명은 조문 텍스트에 없으므로 to_provision_id는 NULL 대신
   같은 대상 법령 집합 내 '시행령/시행규칙' 루트 매칭은 후속 과제 — 여기선
   from_provision → 자기 법령의 시행령/시행규칙 조문 존재 여부로 근사 매칭)
- 인용: 「<법령명>」 제N조(의M) 패턴 → cites. 대상 조문이 legal_provisions에 있으면 엣지 저장,
  없으면 외부 법령 조문(referenced_external)으로 등록 후 엣지 생성.
"""
import os
import re
import sys
import psycopg
from dotenv import load_dotenv

DELEGATE_RE = re.compile(
    r"(대통령령|총리령|부령|식품의약품안전처장이\s*정하여\s*고시)으로?\s*정하는\s*바에?\s*따라"
    r"|(대통령령|총리령|부령)으로\s*정한다"
)
CITE_RE = re.compile(r"「([^」]+)」\s*제(\d+조(?:의\d+)?)")

# 참조 시 법령명 정규화(접두 '「' 내부 표기 → 실제 law_name 매핑)
NAME_ALIASES = {
    "건강기능식품에 관한 법률": "건강기능식품에 관한 법률",
    "건강기능식품에관한법률": "건강기능식품에 관한 법률",
    "식품 등의 표시ㆍ광고에 관한 법률": "식품 등의 표시ㆍ광고에 관한 법률",
    "식품 등의 표시·광고에 관한 법률": "식품 등의 표시ㆍ광고에 관한 법률",
    "식품 등의 표시·광고에 관한 법률": "식품 등의 표시ㆍ광고에 관한 법률",
}


def find_provision(cur, law_name: str, article_no: str):
    cur.execute(
        "SELECT id FROM legal_provisions WHERE law_name=%s AND article_no=%s LIMIT 1",
        (law_name, article_no),
    )
    row = cur.fetchone()
    return row[0] if row else None


def main() -> None:
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    db_url = os.environ.get(
        "DATABASE_URL", "postgresql://nutrition:nutrition_dev_pw@localhost:5433/nutrition_mind"
    )
    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        cur.execute("SELECT id, law_name, article_no, content FROM legal_provisions")
        rows = cur.fetchall()

        created = 0
        for pid, law_name, article_no, content in rows:
            text = content or ""

            # 1) 위임 엣지: 법률→시행령, 시행령→시행규칙 계열 근사 매칭
            for m in DELEGATE_RE.finditer(text):
                target_law = None
                if law_name.endswith("법률"):
                    target_law = law_name + " 시행령"
                elif law_name.endswith("시행령"):
                    target_law = law_name[:-2] + " 시행규칙"
                if not target_law:
                    continue
                # 위임받는 구체 조문은 특정 불가 → 대상 법령 존재 확인 후 자기 참조 엣지는 스킵,
                # from → 대상 법령의 '제1조'와 연결하는 근사 엣지 생성
                to_id = find_provision(cur, target_law, "1")
                if to_id:
                    cur.execute(
                        """INSERT INTO provision_references
                             (from_provision_id, to_provision_id, reference_type)
                           VALUES (%s, %s, 'delegates_to')
                           ON CONFLICT DO NOTHING""",
                        (pid, to_id),
                    )
                    created += cur.rowcount

            # 2) 인용 엣지: 「법령명」 제N조
            for m in CITE_RE.finditer(text):
                cited_law_raw, cited_article = m.group(1).strip(), m.group(2).strip()
                cited_law = NAME_ALIASES.get(cited_law_raw, cited_law_raw)
                if cited_law == law_name:
                    continue
                to_id = find_provision(cur, cited_law, cited_article)
                if to_id:
                    cur.execute(
                        """INSERT INTO provision_references
                             (from_provision_id, to_provision_id, reference_type)
                           VALUES (%s, %s, 'cites')
                           ON CONFLICT DO NOTHING""",
                        (pid, to_id),
                    )
                    created += cur.rowcount
                    continue
                # 외부 법령 조문 → referenced_external 노드로 등록 후 엣지
                cur.execute(
                    """SELECT id FROM legal_provisions
                       WHERE law_name=%s AND article_no=%s AND law_type='referenced_external'
                       LIMIT 1""",
                    (cited_law, cited_article),
                )
                row = cur.fetchone()
                if row:
                    ext_id = row[0]
                else:
                    cur.execute(
                        """INSERT INTO legal_provisions
                             (law_name, law_type, article_no, article_title, content)
                           VALUES (%s, 'referenced_external', %s, NULL, %s)
                           RETURNING id""",
                        (cited_law, cited_article, f"참조로 수집된 외부 조문: {cited_law_raw} 제{cited_article}"),
                    )
                    ext_id = cur.fetchone()[0]
                cur.execute(
                    """INSERT INTO provision_references
                         (from_provision_id, to_provision_id, reference_type)
                       VALUES (%s, %s, 'cites')
                       ON CONFLICT DO NOTHING""",
                    (pid, ext_id),
                )
                created += cur.rowcount
        conn.commit()
    print(f"✅ 참조 엣지 {created}건 생성")


if __name__ == "__main__":
    main()
