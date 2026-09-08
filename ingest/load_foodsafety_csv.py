"""식약처 CSV 사전 적재 (Task #5 — AC5, AC6).

foodsafetykorea_schema/*.csv를 foodsafety_rows(api_code, payload)로 적재하고
sync_state.total_count 기록. 이후 total_count 기반 증분 감지 기준값으로 사용.

사용법: python load_foodsafety_csv.py --schema-dir ../foodsafetykorea_schema
"""
import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone

import psycopg
from dotenv import load_dotenv

API_CODE_BY_FILE = {
    "I-0050.csv": "I-0050",   # 개별인정형 원료 인정 목록
    "I-0040.csv": "I-0040",   # 개별인정형 기능성 원료 (기타 인정)
    "I0030.csv": "I0030",     # 품목제조신고 (개별인정형 포함)
    "C003.csv": "C003",       # 품목제조신고 (고시형 포함)
}


def rows_from_csv(path: str):
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            yield row


def load(db_url: str, schema_dir: str) -> None:
    now = datetime.now(timezone.utc)
    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        for fname, api_code in API_CODE_BY_FILE.items():
            path = os.path.join(schema_dir, fname)
            if not os.path.exists(path):
                print(f"⚠️  건너뜀(파일 없음): {fname}")
                continue
            count = 0
            for row in rows_from_csv(path):
                cur.execute(
                    "INSERT INTO foodsafety_rows (api_code, payload, fetched_at) VALUES (%s, %s, %s)",
                    (api_code, json.dumps(row, ensure_ascii=False), now),
                )
                count += 1
            cur.execute(
                """INSERT INTO sync_state (api_code, total_count, updated_at)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (api_code) DO UPDATE
                     SET total_count = EXCLUDED.total_count, updated_at = EXCLUDED.updated_at""",
                (api_code, count, now),
            )
            print(f"✅ {fname} → {api_code}: {count}건 적재, sync_state 갱신")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema-dir", default="../foodsafetykorea_schema")
    ap.add_argument("--db-url", default=os.environ.get("DATABASE_URL", ""))
    args = ap.parse_args()
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    db_url = args.db_url or os.environ.get(
        "DATABASE_URL",
        "postgresql://nutrition:nutrition_dev_pw@localhost:5432/nutrition_mind",
    )
    load(db_url, args.schema_dir)
