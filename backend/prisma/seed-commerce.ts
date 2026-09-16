/**
 * 상거래 도메인 시딩 (Epic #3 · T1 #33, ADR-0003) — 주문·주문 항목·결제·배송·배송 이력.
 *
 * 설계:
 *  - 제품 풀: I0030 품목제조신고에서 25종을 선정한다. 성분 매핑 규칙(mapMaterials)으로
 *    후보 원료 텍스트를 채점해 **17개 성분을 최대한 커버**하도록 그리디 선택한다.
 *  - 섭취 제품(CustomerProduct)은 **그 고객의 주문 항목에서 파생**된다(고객당 3~8종).
 *    풀을 공유하므로 "주문한 제품을 섭취 중"이라는 서사가 성립한다.
 *  - 시나리오: 배송중·배송지연·배송완료·결제실패·취소 + 부분배송. 고객의 **가장 최근 주문**에
 *    시나리오를 적용하고 과거 주문은 배송완료로 채운다. 데모 재현성을 위해 일부 고객은 이름으로 고정 배정한다.
 *  - 멱등: 주문번호(ORD-####) 기준 upsert 후 자식 행을 지우고 재생성한다. 이 실행에서 만들지 않은
 *    주문은 삭제한다. 섭취 제품은 source='foodsafety' 행만 재생성한다(수동 등록은 보존).
 *
 * 용어(CONTEXT.md): 주문·주문 항목·결제·배송·배송 이력·운송장 — 성분/원료 혼용 금지.
 */
import { mapMaterials, type IngredientRule } from "../src/ingredient-mapping.service";
import type { PrismaClient } from "../src/generated/prisma/client";

const PRODUCT_POOL_SIZE = 25;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** 시나리오 6종 — 앞의 5종은 필수, 'partial'은 부분배송(Order 1:N Shipment) 실증용. */
const SCENARIOS = ["in_transit", "delivered", "delayed", "payment_failed", "cancelled", "partial"] as const;
type Scenario = (typeof SCENARIOS)[number];

/** 데모 시나리오 고정 배정 — 시연 시 특정 고객으로 재현할 수 있게 이름으로 고정한다. */
const SCENARIO_BY_NAME: Record<string, Scenario> = {
  김건강: "delayed", // "물건이 안 와요" 핵심 데모
  이면역: "in_transit",
  박다이어트: "delivered",
  김서연: "payment_failed",
  이준호: "cancelled",
  박하늘: "partial",
};

const CARRIERS = ["CJ대한통운", "한진택배", "롯데글로벌로지스", "우체국택배"];

interface PoolProduct {
  apiCode: string;
  reportNo: string;
  productName: string;
  rawMaterials: string;
  /** 선정 근거(커버 성분명) — 로그·검증용. */
  covers: string[];
}

interface CustomerRow {
  id: string;
  name: string | null;
}

/**
 * I0030에서 25종 제품 풀을 선정한다.
 * 후보 2만 건을 매핑 규칙으로 채점 → 아직 커버되지 않은 성분을 가장 많이 채우는 후보를 그리디 선택 →
 * 남은 자리는 총 커버 성분 수가 많은 순으로 채운다.
 */
async function selectProductPool(prisma: PrismaClient): Promise<PoolProduct[]> {
  const rules = (await prisma.ingredient.findMany({ orderBy: { createdAt: "asc" } })) as IngredientRule[];
  const candidates = await prisma.$queryRawUnsafe<
    Array<{ api_code: string; report_no: string; product_name: string; raw_material_name: string }>
  >(
    `SELECT api_code, report_no, product_name, raw_material_name
       FROM foodsafety_rows
      WHERE api_code = 'I0030'
        AND product_name IS NOT NULL AND raw_material_name IS NOT NULL
        AND COALESCE(production_ended, '아니오') <> '예'
        AND product_name NOT ILIKE '%TEST%'
        AND COALESCE(manufacturer_name, '') NOT ILIKE '%TEST%'
      ORDER BY report_no
      LIMIT 20000`,
  );

  // 보강: 상위 2만 건만으로는 커버되지 않는 성분(예: 철분·멜라토닌)이 있으므로,
  // 성분 키워드로 직접 후보를 조회해 앞에 붙인다(trgm GIN 인덱스 사용).
  const keywords = new Set<string>();
  for (const r of rules) {
    for (const part of [r.name, r.synonyms ?? "", r.keywords ?? ""]) {
      for (const token of part.split(",")) {
        const t = token.trim();
        if (t.length >= 2) keywords.add(t);
      }
    }
  }
  const kw = [...keywords];
  const targeted =
    kw.length > 0
      ? await prisma.$queryRawUnsafe<Array<{ api_code: string; report_no: string; product_name: string; raw_material_name: string }>>(
          `SELECT api_code, report_no, product_name, raw_material_name
             FROM foodsafety_rows
            WHERE api_code = 'I0030'
              AND product_name IS NOT NULL AND raw_material_name IS NOT NULL
              AND COALESCE(production_ended, '아니오') <> '예'
              AND product_name NOT ILIKE '%TEST%'
              AND (${kw.map((_, i) => `raw_material_name ILIKE $${i + 1}`).join(" OR ")})
            ORDER BY report_no
            LIMIT 3000`,
          ...kw.map((k) => `%${k}%`),
        )
      : [];

  const seenKeys = new Set<string>();
  const allCandidates = [...targeted, ...candidates].filter((c) => {
    const key = `${c.api_code}:${c.report_no}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  const scored = allCandidates.map((c) => {
    const mapping = mapMaterials(
      [{ productName: c.product_name, rawMaterialText: c.raw_material_name, source: "intake_product" as const }],
      rules,
    );
    return {
      product: {
        apiCode: c.api_code,
        reportNo: c.report_no,
        productName: c.product_name,
        rawMaterials: c.raw_material_name,
        covers: mapping.matches.map((m) => m.ingredientName),
      } satisfies PoolProduct,
      coveredIds: new Set(mapping.matches.map((m) => m.ingredientId)),
    };
  });

  // 그리디: 미커버 성분을 가장 많이 새로 채우는 후보부터 선택.
  const universe = new Set(rules.map((r) => r.id));
  const uncovered = new Set(universe);
  const picked: PoolProduct[] = [];
  const pickedKeys = new Set<string>();
  while (picked.length < PRODUCT_POOL_SIZE && uncovered.size > 0) {
    let best: (typeof scored)[number] | null = null;
    let bestGain = 0;
    for (const s of scored) {
      const key = `${s.product.apiCode}:${s.product.reportNo}`;
      if (pickedKeys.has(key)) continue;
      let gain = 0;
      for (const id of s.coveredIds) if (uncovered.has(id)) gain++;
      if (gain > bestGain) {
        bestGain = gain;
        best = s;
      }
    }
    if (!best || bestGain === 0) break;
    picked.push(best.product);
    pickedKeys.add(`${best.product.apiCode}:${best.product.reportNo}`);
    for (const id of best.coveredIds) uncovered.delete(id);
  }

  // 남은 자리는 총 커버 성분 수가 많은 순으로.
  if (picked.length < PRODUCT_POOL_SIZE) {
    const rest = scored
      .filter((s) => !pickedKeys.has(`${s.product.apiCode}:${s.product.reportNo}`))
      .sort((a, b) => b.coveredIds.size - a.coveredIds.size);
    for (const s of rest) {
      if (picked.length >= PRODUCT_POOL_SIZE) break;
      picked.push(s.product);
      pickedKeys.add(`${s.product.apiCode}:${s.product.reportNo}`);
    }
  }

  const coveredNames = new Set(picked.flatMap((p) => p.covers));
  const missing = rules.filter((r) => !coveredNames.has(r.name)).map((r) => r.name);
  console.log(
    `   제품 풀 ${picked.length}종 선정 — 성분 커버 ${coveredNames.size}/${rules.length}` +
      (missing.length > 0 ? ` (미커버: ${missing.join(", ")})` : ""),
  );
  return picked;
}

/** 배송 상태에 따른 운송장·일시·이력을 만든다. */
function buildShipment(
  status: "ready" | "collected" | "in_transit" | "delivered" | "delayed" | "failed",
  orderIndex: number,
  now: number,
  trackingSeq: number,
) {
  const carrier = CARRIERS[orderIndex % CARRIERS.length];
  const base = {
    carrier,
    trackingNo: `${1000 + (trackingSeq % 9000)}-${2000 + (trackingSeq % 8000)}-${3000 + (trackingSeq % 7000)}`,
  };
  const ev = (s: string, at: number, location: string, note: string) => ({ status: s, occurredAt: new Date(at), location, note });
  switch (status) {
    case "ready":
      return { ...base, status, promisedAt: new Date(now + 3 * DAY), shippedAt: null, deliveredAt: null, events: [ev("ready", now - 2 * HOUR, "물류센터", "출고 준비")] };
    case "collected":
      return { ...base, status, promisedAt: new Date(now + 2 * DAY), shippedAt: new Date(now - 1 * DAY), deliveredAt: null, events: [ev("ready", now - 2 * DAY, "물류센터", "출고 준비"), ev("collected", now - 1 * DAY, "물류센터", "집화 완료")] };
    case "in_transit":
      return {
        ...base,
        status,
        promisedAt: new Date(now + 2 * DAY),
        shippedAt: new Date(now - 1 * DAY),
        deliveredAt: null,
        events: [ev("ready", now - 2 * DAY, "물류센터", "출고 준비"), ev("collected", now - 1 * DAY, "물류센터", "집화 완료"), ev("in_transit", now - 12 * HOUR, "간선상차", "배송 중")],
      };
    case "delivered":
      return {
        ...base,
        status,
        promisedAt: new Date(now - 3 * DAY),
        shippedAt: new Date(now - 5 * DAY),
        deliveredAt: new Date(now - 3 * DAY),
        events: [
          ev("ready", now - 6 * DAY, "물류센터", "출고 준비"),
          ev("collected", now - 5 * DAY, "물류센터", "집화 완료"),
          ev("in_transit", now - 4 * DAY, "간선상차", "배송 중"),
          ev("delivered", now - 3 * DAY, "배송지", "배송 완료"),
        ],
      };
    case "delayed":
      // 집화 후 5일간 정체 — 약속 배송일(3일 전)을 넘겼다.
      return {
        ...base,
        status,
        promisedAt: new Date(now - 3 * DAY),
        shippedAt: new Date(now - 6 * DAY),
        deliveredAt: null,
        events: [
          ev("ready", now - 7 * DAY, "물류센터", "출고 준비"),
          ev("collected", now - 6 * DAY, "물류센터", "집화 완료"),
          ev("in_transit", now - 5 * DAY, "간선상차", "배송 중"),
          ev("delayed", now - 5 * DAY, "중간물류센터", "배송 지연 — 물류센터 보관 중(5일 경과)"),
        ],
      };
    case "failed":
      return {
        ...base,
        status,
        promisedAt: new Date(now - 1 * DAY),
        shippedAt: new Date(now - 3 * DAY),
        deliveredAt: null,
        events: [ev("ready", now - 4 * DAY, "물류센터", "출고 준비"), ev("collected", now - 3 * DAY, "물류센터", "집화 완료"), ev("failed", now - 1 * DAY, "배송지", "배송 실패 — 수취인 부재")],
      };
  }
}

export async function seedCommerce(prisma: PrismaClient): Promise<void> {
  const pool = await selectProductPool(prisma);
  const customers = await prisma.$queryRawUnsafe<CustomerRow[]>("SELECT id, name FROM customers ORDER BY name");

  const now = Date.now();
  let orderSeq = 0;
  let trackingSeq = 0;

  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];
    const scenario: Scenario = SCENARIO_BY_NAME[customer.name ?? ""] ?? SCENARIOS[i % SCENARIOS.length];
    const productCount = 3 + (i % 6); // 3~8종
    const products = Array.from({ length: productCount }, (_, k) => pool[(i * 3 + k) % pool.length]);
    const orderCount = 1 + (i % 3); // 1~3건

    // 제품을 주문들에 순환 분배(고객당 3~8종, 주문당 최소 1종 보장).
    const groups: PoolProduct[][] = Array.from({ length: orderCount }, () => []);
    products.forEach((p, k) => groups[k % orderCount].push(p));

    const orderNos: string[] = [];
    for (let o = 0; o < orderCount; o++) {
      // 가장 최근 주문(o=0)에 시나리오 적용, 과거 주문은 배송완료.
      const s: Scenario = o === 0 ? scenario : "delivered";
      const orderNo = `ORD-${String(++orderSeq).padStart(4, "0")}`;
      orderNos.push(orderNo);
      const orderedAt = new Date(now - (o === 0 ? 8 * DAY : (40 + o * 25) * DAY));

      const items = groups[o].map((p, k) => ({
        apiCode: p.apiCode,
        reportNo: p.reportNo,
        productName: p.productName,
        rawMaterials: p.rawMaterials,
        quantity: 1 + ((i + k + o) % 2),
        unitAmount: 15000 + ((p.reportNo.charCodeAt(4) * 137) % 30000),
      }));
      const totalAmount = items.reduce((sum, it) => sum + it.quantity * it.unitAmount, 0);

      const orderStatus =
        s === "cancelled" ? "cancelled" : s === "payment_failed" ? "pending_payment" : s === "delivered" ? "delivered" : "shipping";

      const order = await prisma.order.upsert({
        where: { orderNo },
        update: { customerId: customer.id, status: orderStatus, orderedAt, totalAmount },
        create: { orderNo, customerId: customer.id, status: orderStatus, orderedAt, totalAmount },
      });
      // 자식 행 재생성(멱등) — 배송 이력은 배송 삭제에 cascade된다.
      await prisma.shipment.deleteMany({ where: { orderId: order.id } });
      await prisma.payment.deleteMany({ where: { orderId: order.id } });
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });

      await prisma.orderItem.createMany({ data: items.map((it) => ({ ...it, orderId: order.id })) });

      if (s === "payment_failed") {
        await prisma.payment.create({
          data: { orderId: order.id, status: "failed", method: "card", amount: totalAmount, paidAt: null, failedReason: "카드 한도 초과" },
        });
      } else if (s === "cancelled") {
        await prisma.payment.create({
          data: { orderId: order.id, status: "refunded", method: "card", amount: totalAmount, paidAt: new Date(orderedAt.getTime() + HOUR) },
        });
      } else {
        await prisma.payment.create({
          data: { orderId: order.id, status: "paid", method: "card", amount: totalAmount, paidAt: new Date(orderedAt.getTime() + HOUR) },
        });
      }

      // 배송: 결제실패·취소는 미출고(배송 없음). 부분배송은 2건(1건 완료 + 1건 배송중).
      if (s === "partial") {
        for (const st of ["delivered", "in_transit"] as const) {
          const built = buildShipment(st, o, now, ++trackingSeq);
          const ship = await prisma.shipment.create({
            data: { orderId: order.id, status: built.status, carrier: built.carrier, trackingNo: built.trackingNo, promisedAt: built.promisedAt, shippedAt: built.shippedAt, deliveredAt: built.deliveredAt },
          });
          await prisma.shipmentEvent.createMany({ data: built.events.map((e) => ({ shipmentId: ship.id, ...e })) });
        }
      } else if (s === "in_transit" || s === "delivered" || s === "delayed") {
        const built = buildShipment(s, o, now, ++trackingSeq);
        const ship = await prisma.shipment.create({
          data: { orderId: order.id, status: built.status, carrier: built.carrier, trackingNo: built.trackingNo, promisedAt: built.promisedAt, shippedAt: built.shippedAt, deliveredAt: built.deliveredAt },
        });
        await prisma.shipmentEvent.createMany({ data: built.events.map((e) => ({ shipmentId: ship.id, ...e })) });
      }
    }

    // 이 실행에서 만들지 않은 주문 정리(재실행 시 잔여 방지).
    await prisma.order.deleteMany({ where: { customerId: customer.id, orderNo: { notIn: orderNos } } });

    // 섭취 제품을 주문 항목에서 파생(고객당 3~8종). 수동 등록(source='manual')은 보존한다.
    const derived = products.map((p) => ({
      customerId: customer.id,
      source: "foodsafety",
      apiCode: p.apiCode,
      reportNo: p.reportNo,
      productName: p.productName,
      rawMaterials: p.rawMaterials,
      functionality: null,
    }));
    await prisma.customerProduct.deleteMany({ where: { customerId: customer.id, source: "foodsafety" } });
    await prisma.customerProduct.createMany({ data: derived });
  }

  console.log(
    `✅ 상거래 시딩: 고객 ${customers.length}명 · 주문 ${orderSeq}건 · 제품 풀 ${pool.length}종` +
      ` (시나리오: ${SCENARIOS.join(", ")})`,
  );
}
