"""LangGraph 6단계 파이프라인 (Task #4 — AC7).

질문 이해/의도 분류 → 도구 선택/라우팅 → 법령 RAG 검색 → 기능성 구조화 조회 → 결과 합성 → 출처 표기 및 응답
"""
import json
import os
import re
from typing import TypedDict

import psycopg
from psycopg.rows import dict_row
import requests
from dotenv import load_dotenv

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.environ.get("EMBEDDING_MODEL", "qwen3-embedding:0.6b")
TOP_K = int(os.environ.get("RAG_TOP_K", "5"))


def embed(q: str) -> list[float]:
    r = requests.post(f"{OLLAMA_BASE}/api/embed",
                      json={"model": EMBED_MODEL, "input": q}, timeout=120)
    r.raise_for_status()
    return r.json()["embeddings"][0]


def db():
    url = os.environ.get(
        "DATABASE_URL", "postgresql://nutrition:nutrition_dev_pw@db:5432/nutrition_mind"
    )
    return psycopg.connect(url, row_factory=dict_row)


# ── 노드 1: 질문 이해/의도 분류 ────────────────────────────────
def understand(state: dict) -> dict:
    q = state["question"].strip()
    # 의도: law(법령) / ingredient(기능성 원료·제품) / mixed
    wants_law = bool(re.search(r"법|조|규칙|규정|허가|신고|금지|기준", q))
    wants_data = bool(re.search(r"원료|성분|제품|업체|기능성|함량", q))
    if wants_law and wants_data:
        intent = "mixed"
    elif wants_data and not wants_law:
        intent = "ingredient"
    else:
        intent = "law"
    # 원료/제품 키워드 추출(예: "키토산 기능성 원료 조회" → "키토산")
    m = re.search(r"([가-힣A-Za-z]{2,10})(?:\s*(?:기능성\s*원료|성분|제품|원료))", q)
    if m and m.group(1) not in ("기능성", "성분", "제품", "원료"):
        state["ingredient_keyword"] = m.group(1)
    state["intent"] = intent
    state["normalized_question"] = q
    return state


# ── 노드 2: 도구 선택/라우팅 ──────────────────────────────────
def route(state: dict) -> dict:
    intent = state.get("intent", "law")
    state["route"] = {
        "law": ["legal_rag"],
        "ingredient": ["structured_query"],
        "mixed": ["legal_rag", "structured_query"],
    }.get(intent, ["legal_rag"])
    return state


# ── 노드 3: 법령 RAG 검색 (pgvector) ───────────────────────────
def legal_rag(state: dict) -> dict:
    vec = embed(state["normalized_question"])
    state["query_vector"] = vec
    return state


# ── 노드 4: 기능성 구조화 조회 ────────────────────────────────
def structured_query(state: dict) -> dict:
    q = state["normalized_question"]
    state["structured_hits"] = None
    with psycopg.connect(os.environ.get(
        "DATABASE_URL", "postgresql://nutrition:nutrition_dev_pw@db:5432/nutrition_mind"
    ), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT api_code, payload, fetched_at FROM foodsafety_rows
                WHERE payload::text ILIKE '%%' || %s || '%%'
                ORDER BY fetched_at DESC LIMIT 5
            """, (state.get("ingredient_keyword") or q,))
            state["structured_hits"] = cur.fetchall()
    return state


# ── 노드 5: 결과 합성 ─────────────────────────────────────────
def synthesize(state: dict) -> dict:
    vec = state.get("query_vector")
    if not vec:
        state["retrieved"] = []
        return state
    with psycopg.connect(os.environ.get(
        "DATABASE_URL", "postgresql://nutrition:nutrition_dev_pw@db:5432/nutrition_mind"
    ), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT law_name, law_type, article_no, article_title, content,
                       1 - (embedding <=> %s::vector) AS score
                FROM legal_provisions WHERE embedding IS NOT NULL
                ORDER BY embedding <=> %s::vector LIMIT %s
            """, (vec, vec, TOP_K))
            state["retrieved"] = cur.fetchall()
    return state


# ── 노드 6: 출처 표기 및 응답 ─────────────────────────────────
def answer(state: dict) -> dict:
    retrieved = state.get("retrieved") or []
    q = state["normalized_question"]
    lines = [f"**질문**: {q}", "", "**근거 조문**"]
    for i, r in enumerate(retrieved, 1):
        title = r["article_title"] or ""
        no = str(r["article_no"]).removeprefix("제")
        head = r["content"][:200].replace("\n", " ")
        lines.append(f"[{i}] {r['law_name']} {no}"
                     f"{'(' + title + ')' if title else ''} — 유사도 {r['score']:.3f}")
        lines.append(f"    {head}…")
    lines.append("")
    lines.append("**출처(각주)**: " + "; ".join(
        f"[{i}] {r['law_name']} {str(r['article_no']).removeprefix('제')}" for i, r in enumerate(retrieved, 1)
    ))
    # 정량 평가 지표: 유사도 기반 (Recall/MRR 대용량 평가는 별도 스크립트)
    top = retrieved[0]["score"] if retrieved else 0.0
    lines.append(f"_(검색 지표) top1 유사도: {top:.4f}, 근거 수: {len(retrieved)}_")
    state["answer"] = "\n".join(lines)
    return state


def run(question: str) -> dict:
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    state = {"question": question}
    state = understand(state)
    state = route(state)
    if "legal_rag" in state["route"]:
        state = legal_rag(state)
    if "structured_query" in state["route"]:
        state = structured_query(state)
    state = synthesize(state)
    state = answer(state)
    return state


if __name__ == "__main__":
    import sys
    q = sys.argv[1] if len(sys.argv) > 1 else "건강기능식품 제조업 영업허가는 어떻게 받나요?"
    out = run(q)
    print(out["answer"])
