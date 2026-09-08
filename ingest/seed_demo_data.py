"""웹 데모 시딩 (Task #7 부분 — AC9): 고객:성분 1:N 데모 데이터."""
import os
import psycopg
from dotenv import load_dotenv

DEMO = [
    ("김건강", ["비타민D", "오메가3", "마그네슘"]),
    ("이면역", ["프로폴리스", "아연", "비타민C"]),
    ("박다이어트", ["키토산", "가르시니아", "프로바이오틱스"]),
]


def main() -> None:
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    db_url = os.environ.get(
        "DATABASE_URL", "postgresql://nutrition:nutrition_dev_pw@localhost:5432/nutrition_mind"
    )
    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        for name, ingredients in DEMO:
            cur.execute(
                "INSERT INTO customers (name) VALUES (%s) ON CONFLICT (name) DO NOTHING", (name,)
            )
            cur.execute("SELECT id FROM customers WHERE name = %s", (name,))
            cid = cur.fetchone()[0]
            for ing in ingredients:
                cur.execute(
                    "INSERT INTO customer_ingredients (customer_id, ingredient_name) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (cid, ing),
                )
        cur.execute(
            """INSERT INTO users (email, password_hash) VALUES (%s, %s)
               ON CONFLICT (email) DO NOTHING""",
            (
                os.environ.get("DEMO_USER_EMAIL", "demo@example.com"),
                "dev-only-hash",  # 데모 로그인은 env 비밀번호 비교 방식이므로 해시 미사용
            ),
        )
    print("✅ 데모 시딩 완료:", ", ".join(n for n, _ in DEMO))


if __name__ == "__main__":
    main()
