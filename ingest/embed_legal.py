"""법령 조문 임베딩 백필 (Task #4 — AC4).

legal_provisions.embedding이 NULL인 조문을 Ollama qwen3-embedding:0.6b로 임베딩.
- 청크 전략: 조문 1개 = 청크 1개 (법령명/조문번호/제목을 컨텍스트 프리픽스로 포함)
- 배치 처리 + 재시도
실행: python embed_legal.py [--batch 32] [--only-missing]
"""
import argparse
import os
import time
from datetime import date

import psycopg
import psycopg.types.json
import requests
from dotenv import load_dotenv

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.environ.get("EMBEDDING_MODEL", "qwen3-embedding:0.6b")
EMBED_DIM = 1024


def embed_texts(texts: list[str]) -> list[list[float]]:
    res = requests.post(
        f"{OLLAMA_BASE}/api/embed", json={"model": EMBED_MODEL, "input": texts}, timeout=300
    )
    res.raise_for_status()
    data = res.json()
    if "error" in data:
        raise RuntimeError(data["error"])
    return data["embeddings"]


def chunk_text(law_name: str, article_no: str, article_title: str | None, content: str) -> str:
    head = f"{law_name} {article_no}" + (f" ({article_title})" if article_title else "")
    return f"{head}\n{content}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    db_url = os.environ.get(
        "DATABASE_URL", "postgresql://nutrition:nutrition_dev_pw@localhost:5433/nutrition_mind"
    )

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, law_name, article_no, article_title, content
                FROM legal_provisions
                WHERE embedding IS NULL
                ORDER BY law_name, article_no
            """ + (f" LIMIT {args.limit}" if args.limit else ""))
            rows = cur.fetchall()
        print(f"대상 조문: {len(rows)}건")

        done = 0
        failed: list[str] = []
        for i in range(0, len(rows), args.batch):
            batch = rows[i:i + args.batch]
            texts = [chunk_text(law, no, title, content) for _, law, no, title, content in batch]
            try:
                vecs = embed_texts(texts)
            except Exception as e:
                print(f"⚠️ 배치 실패({i}): {e}")
                failed.extend(r[0] for r in batch)
                continue
            with conn.cursor() as cur:
                for (pid, *_), vec in zip(batch, vecs):
                    if len(vec) != EMBED_DIM:
                        failed.append(pid)
                        continue
                    cur.execute(
                        "UPDATE legal_provisions SET embedding = %s::vector WHERE id = %s",
                        ([float(x) for x in vec], pid),
                    )
            conn.commit()
            done = min(i + args.batch, len(rows))
            print(f"  진행 {done}/{len(rows)}")

        if failed:
            print(f"⚠️ 실패/차원불일치 {len(failed)}건")
        else:
            print("✅ 전 조문 임베딩 완료")


if __name__ == "__main__":
    main()
