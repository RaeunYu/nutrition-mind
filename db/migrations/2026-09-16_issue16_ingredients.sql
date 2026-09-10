-- 이슈 #16: 성분 마스터(ingredients) + 고객 관심 성분(customer_interests) — 가산 마이그레이션.
-- 실행 방법: docker cp 본 파일 → db 컨테이너 /tmp → psql -U nutrition -d nutrition_mind -f (멱등: IF NOT EXISTS)
-- 용어: 성분(표준화된 성분명 — CONTEXT.md) ≠ 원료(식약처 원재료명 텍스트). 성분/원료 혼용 금지.

CREATE TABLE IF NOT EXISTS ingredients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,   -- 표준 성분명(예: 비타민D)
  synonyms   text,                   -- 동의어(쉼표 구분, 예: 콜레칼시페롤)
  keywords   text,                   -- 원료명 매칭용 키워드(쉼표 구분, 예: 유산균,비피두스)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_interests (
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, ingredient_id)   -- (고객, 성분) 유니크 — 관심 성분 중복 지정 차단
);
CREATE INDEX IF NOT EXISTS idx_customer_interests_ingredient ON customer_interests (ingredient_id);