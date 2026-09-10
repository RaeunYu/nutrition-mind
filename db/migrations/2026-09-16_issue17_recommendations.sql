-- 이슈 #17: 성분 갭 기반 추천 제품 제안(product_recommendations) — 가산 마이그레이션.
-- 실행 방법: docker cp 본 파일 → db 컨테이너 /tmp → psql -U nutrition -d nutrition_mind -f (멱등: IF NOT EXISTS)
-- 용어(CONTEXT.md): 성분 갭 = 관심 성분 중 섭취 제품으로 커버되지 않는 성분 — 추천 제안의 근거.
-- 담당자 확인 절차: status proposed →(수용) accepted | (보류) held — 자동 확정(섭취 제품 자동 등록) 없음.

CREATE TABLE IF NOT EXISTS product_recommendations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  api_code      text,                  -- 품목제조신고 API 코드(C003·I0030)
  report_no     text,                  -- 신고번호(연결 식별자 — 이슈 #15 선례: 동일 report_no가 C003·I0030에 공존)
  product_name  text NOT NULL,
  raw_materials text,                  -- 제안 시점 원료 텍스트 스냅샷(근거 표시용)
  status        text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','held')),
  decided_at    timestamptz,           -- 담당자 확인(수용/보류) 시각
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_recommendations_customer ON product_recommendations (customer_id);
CREATE INDEX IF NOT EXISTS idx_product_recommendations_ingredient ON product_recommendations (ingredient_id);

-- 동일 제안 중복 차단: (고객, 성분, 제품) 조합 유니크.
-- 품목제조신고 후보(C003·I0030)는 api_code·report_no가 항상 존재(실측: 전 행 NOT NULL)이므로
-- NULL이 아닌 조합에만 유니크를 적용하는 부분 유니크 인덱스로 정의한다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_recommendations_unique
  ON product_recommendations (customer_id, ingredient_id, api_code, report_no)
  WHERE api_code IS NOT NULL AND report_no IS NOT NULL;