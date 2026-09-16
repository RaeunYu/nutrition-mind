"""Nutrition Mind FastMCP 서버 — 법령·기능성 4종 + 상거래·고객 9종 = 13종 (Epic #3 · T2 #34).

도구 카탈로그(ADR-0003) — 4카테고리 13종:
  법령·기능성(4): search_legal_provisions · get_functional_ingredient · get_product_report · get_notified_functionality
  배송(3):        list_customer_shipments · get_shipment_status · get_tracking_events
  주문·결제(3):   list_customer_orders · get_order_detail · get_payment_status
  고객·성분(3):   get_customer_profile · get_ingredient_gap · search_customers

카테고리 메타데이터는 두 곳에 노출한다(하네스 도구 라우팅이 사용):
  1) MCP tools/list의 `_meta.category` — 기계 판독용(meta={"category": ...})
  2) 도구 description 선두의 `[카테고리: ...]` — 사람이 읽는 설명 및 폴백

접근 로그(ADR-0002 개정) — 고객 데이터를 반환하는 도구는 access_logs에 기록한다.
actor는 하네스가 보내는 X-Actor-Email/X-Actor-Role 헤더에서 읽고, stdio 직접 호출(Claude Desktop)은
actor를 mcp-stdio로 기록한다. 이는 사후 기록이며 접근 통제가 아니다(ADR-0003 비목표: MCP 요청 단위 인증 없음).

주의(중복 로직): get_ingredient_gap은 백엔드(ingredient-mapping.service.ts)와 같은 규칙 소스(ingredients 테이블)를
읽어 같은 정규화(소문자·공백/하이픈 제거 + 부분일치)로 매핑한다. 두 구현의 일치 여부는 T2 검증에서
백엔드 GET /customers/:id/gap 응답과 대조해 확인한다.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import psycopg
import requests
from psycopg.rows import dict_row
from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_headers
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://nutrition:nutrition_dev_pw@db:5432/nutrition_mind")

CAT_KNOWLEDGE = "법령·기능성"
CAT_SHIPPING = "배송"
CAT_ORDER = "주문·결제"
CAT_CUSTOMER = "고객·성분"

mcp = FastMCP("nutrition-mind")


# ─────────────────────────── 공통 헬퍼 ───────────────────────────

def _query(sql: str, params: tuple = ()) -> list[dict]:
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]


def _execute(sql: str, params: tuple = ()) -> None:
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()


def _embed(query: str) -> list[float]:
    model = os.environ.get("EMBEDDING_MODEL", "qwen3-embedding:0.6b")
    ollama = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    res = requests.post(f"{ollama}/api/embed", json={"model": model, "input": query}, timeout=120)
    res.raise_for_status()
    return res.json()["embeddings"][0]


def _actor() -> tuple[str, str]:
    """호출 주체 — 하네스 헤더 우선, stdio 직접 호출은 mcp-stdio(ADR-0002 개정)."""
    try:
        raw = get_http_headers() or {}
    except Exception:
        raw = {}
    headers = {str(k).lower(): v for k, v in raw.items()}
    email = headers.get("x-actor-email") or "mcp-stdio"
    role = headers.get("x-actor-role") or "consultant"
    return str(email), str(role)


def _record_access(customer_ids: list[str]) -> None:
    """고객 데이터 반환 도구의 접근 로그. 기록 실패가 도구 실행을 막지 않는다(사후 기록)."""
    ids = [c for c in dict.fromkeys(customer_ids) if c]
    if not ids:
        return
    email, role = _actor()
    try:
        for cid in ids:
            _execute(
                "INSERT INTO access_logs (actor_email, actor_role, customer_id) VALUES (%s, %s, %s::uuid)",
                (email, role, cid),
            )
    except Exception as e:  # noqa: BLE001
        print(f"[access-log] 기록 실패: {e}", file=sys.stderr)


def _now() -> datetime:
    return datetime.now(timezone.utc)


ORDER_LABEL = {
    "pending_payment": "결제대기",
    "paid": "결제완료",
    "preparing": "상품준비",
    "shipping": "배송중",
    "delivered": "배송완료",
    "cancelled": "취소",
}
PAYMENT_LABEL = {"paid": "결제완료", "failed": "결제실패", "refunded": "환불완료"}
SHIPMENT_LABEL = {
    "ready": "준비",
    "collected": "집화완료",
    "in_transit": "배송중",
    "delivered": "배송완료",
    "delayed": "배송지연",
    "failed": "배송실패",
}
EVENT_LABEL = {
    "ready": "출고 준비",
    "collected": "집화 완료",
    "in_transit": "배송 중",
    "delivered": "배송 완료",
    "delayed": "배송 지연",
    "failed": "배송 실패",
}


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


# ─────────────────────────── 법령·기능성 (기존 4종) ───────────────────────────

@mcp.tool(tags={"knowledge"}, meta={"category": CAT_KNOWLEDGE})
def search_legal_provisions(query: str, law_name: str | None = None, top_k: int = 5) -> str:
    """[카테고리: 법령·기능성] 법령 조문 검색(pgvector 벡터 유사도, qwen3-embedding:0.6b)."""
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


@mcp.tool(tags={"knowledge"}, meta={"category": CAT_KNOWLEDGE})
def get_functional_ingredient(ingredient_name: str) -> str:
    """[카테고리: 법령·기능성] 식약처 기능성 원료 구조화 조회(개별인정형 중심, I-0050 등)."""
    rows = _query(
        """SELECT api_code, payload, fetched_at FROM foodsafety_rows
           WHERE api_code IN ('I-0050','I-0040')
             AND payload::text ILIKE '%%' || %s || '%%'
           ORDER BY fetched_at DESC LIMIT 20""",
        (ingredient_name,),
    )
    return json.dumps({"ingredient": ingredient_name, "rows": rows}, ensure_ascii=False, default=str)


@mcp.tool(tags={"knowledge"}, meta={"category": CAT_KNOWLEDGE})
def get_product_report(product_name: str) -> str:
    """[카테고리: 법령·기능성] 품목제조신고 조회(I0030/C003 등 구조화 조회)."""
    rows = _query(
        """SELECT api_code, payload, fetched_at FROM foodsafety_rows
           WHERE api_code IN ('I0030','C003')
             AND payload::text ILIKE '%%' || %s || '%%'
           ORDER BY fetched_at DESC LIMIT 20""",
        (product_name,),
    )
    return json.dumps({"product": product_name, "rows": rows}, ensure_ascii=False, default=str)


@mcp.tool(tags={"knowledge"}, meta={"category": CAT_KNOWLEDGE})
def get_notified_functionality(function_name: str) -> str:
    """[카테고리: 법령·기능성] 고시기능성 조회(고시형 원료/기능)."""
    rows = _query(
        """SELECT api_code, payload, fetched_at FROM foodsafety_rows
           WHERE api_code = 'notified_functionality'
             AND payload::text ILIKE '%%' || %s || '%%'
           ORDER BY fetched_at DESC LIMIT 20""",
        (function_name,),
    )
    return json.dumps({"function": function_name, "rows": rows}, ensure_ascii=False, default=str)


# ─────────────────────────── 배송 (3종) ───────────────────────────

_SHIPMENT_SELECT = """
    SELECT s.id AS shipment_id, o.order_no, o.customer_id, o.status AS order_status,
           s.status, s.carrier, s.tracking_no, s.promised_at, s.shipped_at, s.delivered_at,
           (SELECT e.status FROM shipment_events e WHERE e.shipment_id = s.id
             ORDER BY e.occurred_at DESC LIMIT 1) AS last_event_status,
           (SELECT e.occurred_at FROM shipment_events e WHERE e.shipment_id = s.id
             ORDER BY e.occurred_at DESC LIMIT 1) AS last_event_at
      FROM shipments s JOIN orders o ON o.id = s.order_id
"""


def _shipment_view(row: dict) -> dict:
    status = row["status"]
    promised = row.get("promised_at")
    last_at = row.get("last_event_at")
    now = _now()
    delay_days = 0
    if promised is not None and status not in ("delivered", "failed") and promised < now:
        delay_days = (now - promised).days
    stalled_days = 0
    if last_at is not None and status in ("ready", "collected", "in_transit", "delayed"):
        stalled_days = (now - last_at).days
    return {
        "shipmentId": row["shipment_id"],
        "orderNo": row["order_no"],
        "orderStatus": status_label(ORDER_LABEL, row.get("order_status")),
        "status": status_label(SHIPMENT_LABEL, status),
        "statusCode": status,
        "carrier": row.get("carrier"),
        "trackingNo": row.get("tracking_no"),
        "promisedAt": _iso(promised),
        "shippedAt": _iso(row.get("shipped_at")),
        "deliveredAt": _iso(row.get("delivered_at")),
        "lastEvent": status_label(EVENT_LABEL, row.get("last_event_status")),
        "lastEventAt": _iso(last_at),
        # 지연 판단: 상태가 지연이거나, 약속일을 넘겼거나, 진행 중인데 3일 이상 정체
        "isDelayed": bool(status == "delayed" or delay_days > 0 or stalled_days >= 3),
        "delayDays": delay_days,
        "stalledDays": stalled_days,
    }


def status_label(mapping: dict, code) -> str | None:
    if code is None:
        return None
    return mapping.get(str(code), str(code))


@mcp.tool(tags={"shipping"}, meta={"category": CAT_SHIPPING})
def list_customer_shipments(customer_id: str) -> str:
    """[카테고리: 배송] 고객의 배송 목록과 상태 요약(최근 주문순). customer_id는 고객 UUID."""
    rows = _query(_SHIPMENT_SELECT + " WHERE o.customer_id = %s::uuid ORDER BY o.ordered_at DESC", (customer_id,))
    _record_access([customer_id])
    return json.dumps(
        {"customerId": customer_id, "count": len(rows), "shipments": [_shipment_view(r) for r in rows]},
        ensure_ascii=False,
        default=str,
    )


@mcp.tool(tags={"shipping"}, meta={"category": CAT_SHIPPING})
def get_shipment_status(order_no: str | None = None, shipment_id: str | None = None) -> str:
    """[카테고리: 배송] 배송 단건 상태 — 지연 여부·약속 배송일·마지막 이벤트. order_no 또는 shipment_id 중 하나 필수."""
    if not order_no and not shipment_id:
        return json.dumps({"error": "order_no 또는 shipment_id가 필요합니다."}, ensure_ascii=False)
    if shipment_id:
        rows = _query(_SHIPMENT_SELECT + " WHERE s.id = %s::uuid", (shipment_id,))
    else:
        rows = _query(_SHIPMENT_SELECT + " WHERE o.order_no = %s ORDER BY s.created_at", (order_no,))
    if not rows:
        return json.dumps({"error": "배송을 찾을 수 없습니다.", "orderNo": order_no, "shipmentId": shipment_id}, ensure_ascii=False)
    _record_access([r["customer_id"] for r in rows])
    views = [_shipment_view(r) for r in rows]
    return json.dumps(
        {"shipments": views, "isDelayed": any(v["isDelayed"] for v in views)},
        ensure_ascii=False,
        default=str,
    )


@mcp.tool(tags={"shipping"}, meta={"category": CAT_SHIPPING})
def get_tracking_events(shipment_id: str) -> str:
    """[카테고리: 배송] 배송 이력(운송장·이벤트 시간순) — 배송 지연 판단 근거."""
    ship = _query(_SHIPMENT_SELECT + " WHERE s.id = %s::uuid", (shipment_id,))
    if not ship:
        return json.dumps({"error": "배송을 찾을 수 없습니다.", "shipmentId": shipment_id}, ensure_ascii=False)
    _record_access([ship[0]["customer_id"]])
    events = _query(
        """SELECT status, location, note, occurred_at FROM shipment_events
           WHERE shipment_id = %s::uuid ORDER BY occurred_at""",
        (shipment_id,),
    )
    view = _shipment_view(ship[0])
    view["events"] = [
        {
            "status": status_label(EVENT_LABEL, e["status"]),
            "statusCode": e["status"],
            "location": e.get("location"),
            "note": e.get("note"),
            "occurredAt": _iso(e["occurred_at"]),
        }
        for e in events
    ]
    return json.dumps(view, ensure_ascii=False, default=str)


# ─────────────────────────── 주문·결제 (3종) ───────────────────────────

@mcp.tool(tags={"order"}, meta={"category": CAT_ORDER})
def list_customer_orders(customer_id: str) -> str:
    """[카테고리: 주문·결제] 고객의 주문 목록 — 주문 상태·결제 상태·배송 건수 요약."""
    orders = _query(
        """SELECT o.id, o.order_no, o.status, o.ordered_at, o.total_amount,
                  p.status AS payment_status, p.method AS payment_method,
                  (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id) AS shipment_count,
                  (SELECT string_agg(DISTINCT s.status, ',') FROM shipments s WHERE s.order_id = o.id) AS shipment_statuses
             FROM orders o LEFT JOIN payments p ON p.order_id = o.id
            WHERE o.customer_id = %s::uuid
            ORDER BY o.ordered_at DESC""",
        (customer_id,),
    )
    _record_access([customer_id])
    return json.dumps(
        {
            "customerId": customer_id,
            "count": len(orders),
            "orders": [
                {
                    "orderNo": o["order_no"],
                    "status": status_label(ORDER_LABEL, o["status"]),
                    "statusCode": o["status"],
                    "orderedAt": _iso(o["ordered_at"]),
                    "totalAmount": o["total_amount"],
                    "paymentStatus": status_label(PAYMENT_LABEL, o.get("payment_status")),
                    "paymentMethod": o.get("payment_method"),
                    "shipmentCount": o["shipment_count"],
                    "shipmentStatuses": [
                        status_label(SHIPMENT_LABEL, s) for s in (o.get("shipment_statuses") or "").split(",") if s
                    ],
                }
                for o in orders
            ],
        },
        ensure_ascii=False,
        default=str,
    )


@mcp.tool(tags={"order"}, meta={"category": CAT_ORDER})
def get_order_detail(order_no: str) -> str:
    """[카테고리: 주문·결제] 주문 상세 — 주문 항목(제품·수량·금액)과 결제·배송 요약."""
    orders = _query(
        """SELECT o.id, o.order_no, o.customer_id, o.status, o.ordered_at, o.total_amount,
                  p.status AS payment_status, p.method AS payment_method, p.amount AS payment_amount,
                  p.paid_at, p.failed_reason
             FROM orders o LEFT JOIN payments p ON p.order_id = o.id
            WHERE o.order_no = %s""",
        (order_no,),
    )
    if not orders:
        return json.dumps({"error": "주문을 찾을 수 없습니다.", "orderNo": order_no}, ensure_ascii=False)
    order = orders[0]
    _record_access([order["customer_id"]])
    items = _query(
        """SELECT api_code, report_no, product_name, raw_materials, quantity, unit_amount
             FROM order_items WHERE order_id = %s::uuid ORDER BY created_at""",
        (order["id"],),
    )
    shipments = _query(_SHIPMENT_SELECT + " WHERE s.order_id = %s::uuid ORDER BY s.created_at", (order["id"],))
    return json.dumps(
        {
            "orderNo": order["order_no"],
            "status": status_label(ORDER_LABEL, order["status"]),
            "statusCode": order["status"],
            "orderedAt": _iso(order["ordered_at"]),
            "totalAmount": order["total_amount"],
            "payment": {
                "status": status_label(PAYMENT_LABEL, order.get("payment_status")),
                "statusCode": order.get("payment_status"),
                "method": order.get("payment_method"),
                "amount": order.get("payment_amount"),
                "paidAt": _iso(order.get("paid_at")),
                "failedReason": order.get("failed_reason"),
            },
            "items": [
                {
                    "apiCode": i["api_code"],
                    "reportNo": i["report_no"],
                    "productName": i["product_name"],
                    "rawMaterials": i["raw_materials"],
                    "quantity": i["quantity"],
                    "unitAmount": i["unit_amount"],
                }
                for i in items
            ],
            "shipments": [_shipment_view(s) for s in shipments],
        },
        ensure_ascii=False,
        default=str,
    )


@mcp.tool(tags={"order"}, meta={"category": CAT_ORDER})
def get_payment_status(order_no: str) -> str:
    """[카테고리: 주문·결제] 주문의 결제 상태(결제완료/결제실패/환불완료)와 실패 사유."""
    rows = _query(
        """SELECT o.order_no, o.customer_id, o.status AS order_status, p.status, p.method, p.amount,
                  p.paid_at, p.failed_reason
             FROM orders o LEFT JOIN payments p ON p.order_id = o.id
            WHERE o.order_no = %s""",
        (order_no,),
    )
    if not rows:
        return json.dumps({"error": "주문을 찾을 수 없습니다.", "orderNo": order_no}, ensure_ascii=False)
    _record_access([rows[0]["customer_id"]])
    r = rows[0]
    return json.dumps(
        {
            "orderNo": r["order_no"],
            "orderStatus": status_label(ORDER_LABEL, r["order_status"]),
            "status": status_label(PAYMENT_LABEL, r.get("status")),
            "statusCode": r.get("status"),
            "method": r.get("method"),
            "amount": r.get("amount"),
            "paidAt": _iso(r.get("paid_at")),
            "failedReason": r.get("failed_reason"),
        },
        ensure_ascii=False,
        default=str,
    )


# ─────────────────────────── 고객·성분 (3종) ───────────────────────────

@mcp.tool(tags={"customer"}, meta={"category": CAT_CUSTOMER})
def search_customers(name: str) -> str:
    """[카테고리: 고객·성분] 이름으로 고객을 찾는다(부분일치). 반환: 고객 ID·이름·주문 수·최근 배송 상태.

    연락처·이메일·메모는 봉투 암호화(ADR-0002)되어 있어 MCP 서버가 복호화 키를 갖지 않는다.
    따라서 이 도구는 마스킹 연락처조차 반환하지 않는다(개인정보 최소노출).
    """
    rows = _query(
        """SELECT c.id, c.name,
                  (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count,
                  (SELECT s.status FROM shipments s JOIN orders o2 ON o2.id = s.order_id
                    WHERE o2.customer_id = c.id ORDER BY o2.ordered_at DESC, s.created_at DESC LIMIT 1) AS latest_shipment
             FROM customers c
            WHERE c.name IS NOT NULL AND c.name ILIKE '%%' || %s || '%%'
            ORDER BY c.name
            LIMIT 20""",
        (name,),
    )
    _record_access([r["id"] for r in rows])
    return json.dumps(
        {
            "query": name,
            "count": len(rows),
            "customers": [
                {
                    "customerId": r["id"],
                    "name": r["name"],
                    "orderCount": r["order_count"],
                    "latestShipmentStatus": status_label(SHIPMENT_LABEL, r.get("latest_shipment")),
                }
                for r in rows
            ],
        },
        ensure_ascii=False,
        default=str,
    )


@mcp.tool(tags={"customer"}, meta={"category": CAT_CUSTOMER})
def get_customer_profile(customer_id: str) -> str:
    """[카테고리: 고객·성분] 고객 프로필 — 이름·섭취 제품·수동 성분·관심 성분(연락처 등 암호화 필드는 미포함)."""
    rows = _query("SELECT id, name FROM customers WHERE id = %s::uuid", (customer_id,))
    if not rows:
        return json.dumps({"error": "고객을 찾을 수 없습니다.", "customerId": customer_id}, ensure_ascii=False)
    _record_access([customer_id])
    products = _query(
        """SELECT product_name, raw_materials, source FROM customer_products
            WHERE customer_id = %s::uuid ORDER BY created_at""",
        (customer_id,),
    )
    manual = _query("SELECT ingredient_name FROM customer_ingredients WHERE customer_id = %s::uuid ORDER BY ingredient_name", (customer_id,))
    interests = _query(
        """SELECT i.name FROM customer_interests ci JOIN ingredients i ON i.id = ci.ingredient_id
            WHERE ci.customer_id = %s::uuid ORDER BY i.name""",
        (customer_id,),
    )
    return json.dumps(
        {
            "customerId": customer_id,
            "name": rows[0]["name"],
            "intakeProducts": [
                {"productName": p["product_name"], "rawMaterials": p["raw_materials"], "source": p["source"]} for p in products
            ],
            "manualIngredients": [m["ingredient_name"] for m in manual],
            "interests": [i["name"] for i in interests],
        },
        ensure_ascii=False,
        default=str,
    )


def _normalize(text: str) -> str:
    return text.lower().replace(" ", "").replace("-", "")


def _compile_rules(rules: list[dict]) -> list[dict]:
    compiled = []
    for r in rules:
        pairs = []
        seen = set()
        for part in (r.get("name") or "", r.get("synonyms") or "", r.get("keywords") or ""):
            for token in part.split(","):
                original = token.strip()
                normalized = _normalize(original) if original else ""
                if not normalized or normalized in seen:
                    continue
                seen.add(normalized)
                pairs.append((original, normalized))
        compiled.append({"id": r["id"], "name": r["name"], "keywords": pairs})
    return compiled


@mcp.tool(tags={"customer"}, meta={"category": CAT_CUSTOMER})
def get_ingredient_gap(customer_id: str) -> str:
    """[카테고리: 고객·성분] 성분 갭 — 관심 성분별 커버 여부와 근거(섭취 제품 원료·수동 성분), 미커버 성분 목록."""
    rows = _query("SELECT id FROM customers WHERE id = %s::uuid", (customer_id,))
    if not rows:
        return json.dumps({"error": "고객을 찾을 수 없습니다.", "customerId": customer_id}, ensure_ascii=False)
    _record_access([customer_id])

    rules = _compile_rules(
        _query("SELECT id, name, synonyms, keywords FROM ingredients ORDER BY created_at")
    )
    products = _query(
        "SELECT product_name, raw_materials FROM customer_products WHERE customer_id = %s::uuid ORDER BY created_at",
        (customer_id,),
    )
    manual = _query("SELECT ingredient_name FROM customer_ingredients WHERE customer_id = %s::uuid", (customer_id,))
    interests = _query(
        """SELECT i.id AS ingredient_id, i.name FROM customer_interests ci JOIN ingredients i ON i.id = ci.ingredient_id
            WHERE ci.customer_id = %s::uuid ORDER BY i.created_at""",
        (customer_id,),
    )

    matched: dict[str, list[dict]] = {}
    unmapped: list[dict] = []
    for p in products:
        text = (p.get("raw_materials") or "").strip()
        if not text:
            continue
        normalized = _normalize(text)
        hits = 0
        for rule in rules:
            hit = next((kw for kw in rule["keywords"] if kw[1] in normalized), None)
            if not hit:
                continue
            hits += 1
            matched.setdefault(rule["id"], []).append(
                {"productName": p["product_name"], "matchedKeyword": hit[0], "rawMaterialText": text, "source": "intake_product"}
            )
        if hits == 0:
            unmapped.append({"productName": p["product_name"], "rawMaterialText": text})
    for m in manual:
        name = m["ingredient_name"]
        normalized = _normalize(name)
        for rule in rules:
            hit = next((kw for kw in rule["keywords"] if kw[1] in normalized), None)
            if hit:
                matched.setdefault(rule["id"], []).append(
                    {"productName": None, "matchedKeyword": hit[0], "rawMaterialText": name, "source": "manual_ingredient"}
                )

    interests_view = []
    gap = []
    for i in interests:
        ev = matched.get(i["ingredient_id"], [])
        covered = len(ev) > 0
        interests_view.append({"ingredientId": i["ingredient_id"], "name": i["name"], "covered": covered, "evidence": ev})
        if not covered:
            gap.append({"ingredientId": i["ingredient_id"], "name": i["name"]})
    return json.dumps(
        {"customerId": customer_id, "interests": interests_view, "gap": gap, "unmappedMaterials": unmapped},
        ensure_ascii=False,
        default=str,
    )


# ─────────────────────────── HTTP 앱 ───────────────────────────

async def health(request):
    return JSONResponse({"status": "ok", "service": "nutrition-mind-mcp"})


mcp_app = mcp.http_app(path="/mcp")
app = Starlette(
    routes=[
        Route("/health", health, methods=["GET"]),
        Mount("/", app=mcp_app),
    ],
    lifespan=mcp_app.lifespan,  # FastMCP 세션 매니저 초기화 필수
)
