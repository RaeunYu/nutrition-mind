"""품목제조신고류(C003·I0030) 정규화 칼럼 백필 (이슈 #12).

foodsafety_rows의 payload(JSON blob)에서 제품명·원료명·기능성 문구·신고번호를
정규화 칼럼으로 추출해 백필한다. 멱등(재실행 안전) + 배치 처리.

추출 대상 필드 (실측: foodsafetykorea_schema/C003.csv·I0030.csv 헤더와 payload 키 일치):
  PRDLST_NM          -> product_name        (제품명)
  RAWMTRL_NM         -> raw_material_name   (원료명)
  PRIMARY_FNCLTY     -> functionality_text  (기능성 문구)
  PRDLST_REPORT_NO   -> report_no           (신고번호)

payload에 값이 없는(키 없음·빈 문자열) 행은 칼럼을 NULL로 둔다(제외).

사용법: python backfill_product_columns.py [--db-url ...] [--batch-size 5000]
"""
import argparse
import os
import sys
import time

import psycopg
from dotenv import load_dotenv

API_CODES = ("C003", "I0030")  # 품목제조신고류

# payload 키 -> 정규화 칼럼
FIELD_MAP = {
    "product_name": "PRDLST_NM",
    "raw_material_name": "RAWMTRL_NM",
    "functionality_text": "PRIMARY_FNCLTY",
    "report_no": "PRDLST_REPORT_NO",
}

# 배치 선정: 정규화 칼럼이 payload 파생값과 다른 행만 (재실행 시 0건 → 멱등)
BATCH_SELECT = """
WITH batch AS (
  SELECT id
  FROM foodsafety_rows
  WHERE api_code = ANY(%(api_codes)s)
    AND ( product_name       IS DISTINCT FROM NULLIF(payload->>%(k_product)s, '')
       OR raw_material_name  IS DISTINCT FROM NULLIF(payload->>%(k_raw)s, '')
       OR functionality_text IS DISTINCT FROM NULLIF(payload->>%(k_fncl)s, '')
       OR report_no          IS DISTINCT FROM NULLIF(payload->>%(k_report)s, '') )
  ORDER BY id
  LIMIT %(limit)s
)
UPDATE foodsafety_rows f
SET product_name       = NULLIF(f.payload->>%(k_product)s, ''),
    raw_material_name  = NULLIF(f.payload->>%(k_raw)s, ''),
    functionality_text = NULLIF(f.payload->>%(k_fncl)s, ''),
    report_no          = NULLIF(f.payload->>%(k_report)s, '')
FROM batch b
WHERE f.id = b.id
RETURNING f.id
"""

# 누락률 검증: payload에 값이 있는데 정규화 칼럼이 NULL인 행 수 (0이어야 함)
MISSING_CHECK = """
SELECT count(*)
FROM foodsafety_rows
WHERE api_code = ANY(%(api_codes)s)
  AND ( (payload ? %(k_product)s AND NULLIF(payload->>%(k_product)s, '') IS NOT NULL AND product_name IS NULL)
     OR (payload ? %(k_raw)s AND NULLIF(payload->>%(k_raw)s, '') IS NOT NULL AND raw_material_name IS NULL)
     OR (payload ? %(k_fncl)s AND NULLIF(payload->>%(k_fncl)s, '') IS NOT NULL AND functionality_text IS NULL)
     OR (payload ? %(k_report)s AND NULLIF(payload->>%(k_report)s, '') IS NOT NULL AND report_no IS NULL) )
"""

# 정합성 샘플 대조: 정규화 칼럼 == payload 파생값 (임의 10건)
# 백필 SET과 동일한 NULLIF·IS NOT DISTINCT FROM 기준으로 비교(빈 문자열·NULL 행 오판 방지)
SAMPLE_CHECK = """
SELECT id, product_name IS NOT DISTINCT FROM NULLIF(payload->>%(k_product)s, '') AS p_ok,
       raw_material_name IS NOT DISTINCT FROM NULLIF(payload->>%(k_raw)s, '') AS r_ok,
       functionality_text IS NOT DISTINCT FROM NULLIF(payload->>%(k_fncl)s, '') AS f_ok,
       report_no IS NOT DISTINCT FROM NULLIF(payload->>%(k_report)s, '') AS n_ok
FROM foodsafety_rows
WHERE api_code = ANY(%(api_codes)s) AND product_name IS NOT NULL
ORDER BY random()
LIMIT %(limit)s
"""


def backfill(cur: psycopg.Cursor, batch_size: int) -> int:
    """배치 반복 백필. 총 갱신 행 수 반환."""
    params = {
        "api_codes": list(API_CODES),
        "k_product": FIELD_MAP["product_name"],
        "k_raw": FIELD_MAP["raw_material_name"],
        "k_fncl": FIELD_MAP["functionality_text"],
        "k_report": FIELD_MAP["report_no"],
    }
    total = 0
    round_no = 0
    while True:
        round_no += 1
        started = time.monotonic()
        rows = cur.execute(BATCH_SELECT, {**params, "limit": batch_size}).fetchall()
        updated = len(rows)
        total += updated
        elapsed = time.monotonic() - started
        print(f"  배치 #{round_no}: {updated}건 갱신 ({elapsed:.2f}s)", flush=True)
        if updated < batch_size:
            break
    return total


def verify(cur: psycopg.Cursor, sample_size: int = 10) -> bool:
    """누락률(0) + 샘플 정합성 검증. 통과 여부 반환."""
    params = {
        "api_codes": list(API_CODES),
        "k_product": FIELD_MAP["product_name"],
        "k_raw": FIELD_MAP["raw_material_name"],
        "k_fncl": FIELD_MAP["functionality_text"],
        "k_report": FIELD_MAP["report_no"],
    }

    target = cur.execute(
        "SELECT count(*) FROM foodsafety_rows WHERE api_code = ANY(%s)", (list(API_CODES),)
    ).fetchone()[0]
    print(f"\n== 검증 (대상 api_code {API_CODES}: {target:,}건) ==")

    missing = cur.execute(MISSING_CHECK, params).fetchone()[0]
    print(f"칼럼 누락률(payload에 값 있는데 칼럼 NULL): {missing}건")
    ok_missing = missing == 0

    samples = cur.execute(SAMPLE_CHECK, {**params, "limit": sample_size}).fetchall()
    mismatches = [r for r in samples if not (r[1] and r[2] and r[3] and r[4])]
    print(f"샘플 정합성 대조: {len(samples)}건 중 불일치 {len(mismatches)}건")
    for r in mismatches[:3]:
        print(f"  ⚠️ 불일치 id={r[0]}: p={r[1]} r={r[2]} f={r[3]} n={r[4]}")

    for col, key in FIELD_MAP.items():
        filled = cur.execute(
            f"SELECT count(*) FROM foodsafety_rows WHERE api_code = ANY(%s) AND {col} IS NOT NULL",
            (list(API_CODES),),
        ).fetchone()[0]
        print(f"{col}: {filled:,}/{target:,}건 채움 ({target - filled:,}건은 payload에 값 없음)")

    return ok_missing and not mismatches


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch-size", type=int, default=5000)
    ap.add_argument("--db-url", default=os.environ.get("DATABASE_URL", ""))
    args = ap.parse_args()
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    db_url = args.db_url or os.environ.get(
        "DATABASE_URL",
        "postgresql://nutrition:nutrition_dev_pw@localhost:5433/nutrition_mind",
    )
    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        total = backfill(cur, args.batch_size)
        print(f"\n백필 완료: 총 {total:,}건 갱신")
        ok = verify(cur)
        if ok:
            print("✅ 검증 통과 (누락률 0, 샘플 정합성 OK)")
        else:
            print("❌ 검증 실패")
            sys.exit(1)