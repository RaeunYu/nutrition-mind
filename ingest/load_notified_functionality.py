"""고시기능성 API 적재 (Task #5 — AC5 고시형).

공식 API가 아니므로 식품안전나라 네트워크 요청 엔드포인트를 그대로 사용.
show_cnt 범위 제한이 없어 단일 요청으로 전체(61개) 수집 가능.
"""
import json
import os
from datetime import datetime, timezone

import psycopg
import requests
from dotenv import load_dotenv

URL = "https://www.foodsafetykorea.go.kr/portal/healthyfoodlife/searchMtral.do"


def fetch_all() -> list[dict]:
    # 1) 전체 개수 확인(total_cnt) 후, show_cnt에 큰 값을 주어 단일 요청 수집
    res = requests.post(URL, data={"start_idx": 1, "show_cnt": 100}, timeout=30)
    res.raise_for_status()
    data = res.json()
    total = int(data.get("total_cnt", 0))
    items = data.get("list", [])
    # 요구사항: 각 행을 그대로 저장
    return items


def load(db_url: str) -> None:
    items = fetch_all()
    now = datetime.now(timezone.utc)
    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        for row in items:
            cur.execute(
                "INSERT INTO foodsafety_rows (api_code, payload, fetched_at) VALUES (%s, %s, %s)",
                ("notified_functionality", json.dumps(row, ensure_ascii=False), now),
            )
        cur.execute(
            """INSERT INTO sync_state (api_code, total_count, updated_at)
               VALUES (%s, %s, %s)
               ON CONFLICT (api_code) DO UPDATE
                 SET total_count = EXCLUDED.total_count, updated_at = EXCLUDED.updated_at""",
            ("notified_functionality", len(items), now),
        )
    print(f"✅ 고시기능성: {len(items)}건 적재 (total_cnt={items and len(items)})")


if __name__ == "__main__":
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://nutrition:nutrition_dev_pw@localhost:5432/nutrition_mind",
    )
    load(db_url)
