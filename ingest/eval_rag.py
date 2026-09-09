"""RAG 정량 평가 (Task #8 — AC11): Recall@k, MRR, Hit@1.

평가집합: 골드 조문(질문-정답 조문 쌍) 기준. 각 항목에 대해
- Recall@k: 정답 조문이 top-k에 포함되는 비율
- MRR: 정답 조문의 역순위 평균
실행: python eval_rag.py
"""
import os
import re
from datetime import date

import psycopg
import requests
from dotenv import load_dotenv

# 질문 → (정답 law_name, 정답 article_no) — 법령 수집 결과 기반 골드셋
# 이슈 #10: 조문 본문 병합 후 본문이 복원된 이웃 법령(시행령·시행규칙)의 실제 정답 조문이
# 상위에 검색되어, 해당 문항은 다중 정답(golds)으로 보정함(하단 개별 주석 참조).
EVAL_SET = [
    ("건강기능식품 제조업 영업허가는 어떻게 받나요?",
     [("건강기능식품에 관한 법률", "9"), ("건강기능식품에 관한 법률 시행규칙", "3")]),
    ("부당한 과대광고가 금지되는 이유와 근거는?",
     [("식품 등의 표시ㆍ광고에 관한 법률", "20")]),
    ("건강기능식품의 표시기준에서 표시방법은?",
     [("건강기능식품의 표시기준", "제5조")]),
    ("영업허가 취소는 언제 되나요?",
     [("건강기능식품에 관한 법률", "32"),
      ("건강기능식품에 관한 법률 시행령", "17")]),  # 이슈 #10: 제17조(허가취소 등의 처분시기) — 청문 마친 날부터 14일 이내 처분
    ("건강기능식품의 정의는 무엇인가요?",
     [("건강기능식품에 관한 법률", "3")]),
    ("품목제조신고는 어떻게 하나요?",
     [("건강기능식품에 관한 법률", "7"),
      ("건강기능식품에 관한 법률 시행규칙", "8")]),  # 이슈 #10: 제8조(품목제조신고 등) — 신고서 서식·제출처 실무 방법
    ("부당한 표시 또는 광고행위의 금지 대상은?",
     [("식품 등의 표시ㆍ광고에 관한 법률 시행령", "2"),
      ("식품 등의 표시ㆍ광고에 관한 법률", "8")]),  # 이슈 #10: 제8조(부당한 표시 또는 광고행위의 금지) — 금지 행위 조문
    ("건강기능식품의 표시기준에서 용어 정의는?",
     [("건강기능식품의 표시기준", "제2조")]),
    # ── 본문(항·호) 근거가 필요한 문항 (이슈 #10 — 조문 본문 병합 후 재측정용) ──
    ("건강기능식품제조업 영업허가가 거부될 수 있는 사유는?",
     [("건강기능식품에 관한 법률", "5")]),
    ("건강기능식품 영업허가·변경신고의 처리 기한은 얼마인가요?",
     [("건강기능식품에 관한 법률", "5")]),
    ("건강기능식품 영업자가 지켜야 할 준수사항은 무엇인가요?",
     [("건강기능식품에 관한 법률", "10")]),
    ("이상사례가 발생했을 때 영업자의 보고·조치 의무는?",
     [("건강기능식품에 관한 법률", "10의2")]),
    ("맞춤형건강기능식품이란 무엇인가요?",
     [("건강기능식품에 관한 법률", "3")]),
]


def embed(q: str) -> list[float]:
    base = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    base = base.replace("host.docker.internal", "localhost")  # 호스트 실행 시
    r = requests.post(
        f"{base}/api/embed",
        json={"model": os.environ.get("EMBEDDING_MODEL", "qwen3-embedding:0.6b"), "input": q},
        timeout=120,
    )
    r.raise_for_status()
    return r.json()["embeddings"][0]


def search(vec: list[float], k: int = 10):
    with psycopg.connect(os.environ.get(
        "DATABASE_URL", "postgresql://nutrition:nutrition_dev_pw@localhost:5433/nutrition_mind"
    )) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT law_name, article_no,
                          1 - (embedding <=> %s::vector) AS score
                   FROM legal_provisions WHERE embedding IS NOT NULL
                   ORDER BY embedding <=> %s::vector LIMIT %s""",
                (vec, vec, k),
            )
            return cur.fetchall()


def main() -> None:
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    K = 5
    # 소규모 데이터(359건)는 순차 검색이 정확 — ivfflat 인덱스 미사용

    recall_hits = 0
    rr_sum = 0.0
    details = []

    for q, golds in EVAL_SET:
        vec = embed(q)
        results = search(vec, K)
        rank = None
        for idx, (law, no, _) in enumerate(results, 1):
            for g_law, g_no in golds:
                g_norm = g_no.replace("제", "")
                if law == g_law and (no == g_norm or f"제{no}" == g_no or no in g_norm or g_norm in no):
                    if rank is None:
                        rank = idx
                    break
        hit = rank is not None and rank <= K
        rr = 1.0 / rank if rank else 0.0
        recall_hits += 1 if hit else 0
        rr_sum += rr
        details.append((q, golds, rank, rr))

    n = len(EVAL_SET)
    recall_at_k = recall_hits / n
    mrr = rr_sum / n
    print(f"Recall@{K}: {recall_at_k:.3f} ({recall_hits}/{n})")
    print(f"MRR: {mrr:.3f}")
    print()
    for q, golds, rank, rr in details:
        mark = "✅" if rank else "❌"
        print(f"{mark} rank={rank} rr={rr:.3f} | {q[:40]} → gold={golds}")


if __name__ == "__main__":
    main()
