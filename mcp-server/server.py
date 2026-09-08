"""Nutrition Mind FastMCP 서버 (토큰 기반 간단 인증 포함).

도구 4종 (seed.yaml AC8):
  1) search_legal_provisions  — 법령 조문 검색 (pgvector RAG, Task #4에서 임베딩 연결)
  2) get_functional_ingredient — 기능성 원료 구조화 조회 (식약처 I-0050 등)
  3) get_product_report        — 품목제조신고 조회 (I0030/C003 계열)
  4) get_notified_functionality — 고시기능성 조회 (고시형)
"""
import os
import json
import psycopg
import requests
from psycopg.rows import dict_row
from fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

MCP_TOKEN = os.environ.get("MCP_TOKEN", "dev-mcp-token-change-me")
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://nutrition:nutrition_dev_pw@db:5432/nutrition_mind")

mcp = FastMCP("nutrition-mind")


def _query(sql: str, params: tuple = ()) -> list[dict]:
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]


def _embed(query: str) -> list[float]:
    ollama = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
    model = os.environ.get("EMBEDDING_MODEL", "qwen3-embedding:0.6b")
    res = requests.post(f"{ollama}/api/embed", json={"model": model, "input": query}, timeout=120)
    res.raise_for_status()
    return res.json()["embeddings"][0]


@mcp.tool
def search_legal_provisions(query: str, law_name: str | None = None, top_k: int = 5) -> str:
    """법령 조문 검색(pgvector 벡터 유사도, qwen3-embedding:0.6b)."""
    vec = _embed(query)
    rows = _query(
        """SELECT law_name, law_type, article_no, article_title, content,
                  1 - (embedding <=> %s::vector) AS score
           FROM legal_provisions
           WHERE embedding IS NOT NULL
             AND (%s::text IS NULL OR law_name = %s::text)
           ORDER BY embedding <=> %s::vector
           LIMIT %s""",
        (vec, law_name, law_name, vec, max(1, min(top_k, 20))),
    )
    return json.dumps({"query": query, "results": rows}, ensure_ascii=False, default=str)


@mcp.tool
def get_functional_ingredient(ingredient_name: str) -> str:
    """식약처 기능성 원료 구조화 조회(개별인정형 중심, I-0050 등)."""
    rows = _query(
        """SELECT api_code, payload, fetched_at FROM foodsafety_rows
           WHERE api_code IN ('I-0050','I-0040')
             AND payload::text ILIKE '%%' || %s || '%%'
           ORDER BY fetched_at DESC LIMIT 20""",
        (ingredient_name,),
    )
    return json.dumps({"ingredient": ingredient_name, "rows": rows}, ensure_ascii=False, default=str)


@mcp.tool
def get_product_report(product_name: str) -> str:
    """품목제조신고 조회(I0030/C003 등 구조화 조회)."""
    rows = _query(
        """SELECT api_code, payload, fetched_at FROM foodsafety_rows
           WHERE api_code IN ('I0030','C003')
             AND payload::text ILIKE '%%' || %s || '%%'
           ORDER BY fetched_at DESC LIMIT 20""",
        (product_name,),
    )
    return json.dumps({"product": product_name, "rows": rows}, ensure_ascii=False, default=str)


@mcp.tool
def get_notified_functionality(function_name: str) -> str:
    """고시기능성 조회(고시형 원료/기능)."""
    rows = _query(
        """SELECT api_code, payload, fetched_at FROM foodsafety_rows
           WHERE api_code = 'notified_functionality'
             AND payload::text ILIKE '%%' || %s || '%%'
           ORDER BY fetched_at DESC LIMIT 20""",
        (function_name,),
    )
    return json.dumps({"function": function_name, "rows": rows}, ensure_ascii=False, default=str)


class TokenAuthMiddleware(BaseHTTPMiddleware):
    """토큰 기반 간단 인증: Authorization: Bearer <MCP_TOKEN> 필수."""

    async def dispatch(self, request, call_next):
        if request.url.path in ("/health", "/", "/health/"):
            return await call_next(request)  # 모니터링용 health는 인증 예외
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer ") or auth[len("Bearer "):] != MCP_TOKEN:
            return JSONResponse({"error": "인증 실패: 유효한 Bearer 토큰이 필요합니다."}, status_code=401)
        return await call_next(request)


async def health(request):
    return JSONResponse({"status": "ok", "service": "nutrition-mind-mcp"})


mcp_app = mcp.http_app(path="/mcp")
app = Starlette(
    routes=[
        Route("/health", health, methods=["GET"]),
        Mount("/", app=mcp_app),
    ],
    middleware=[Middleware(TokenAuthMiddleware)],
    lifespan=mcp_app.lifespan,  # FastMCP 세션 매니저 초기화 필수
)
