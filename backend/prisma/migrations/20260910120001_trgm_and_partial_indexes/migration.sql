-- 이슈 #12·#15·#17·#20 — Prisma 미표현 DDL(pg_trgm GIN·부분 유니크 인덱스) 수동 마이그레이션
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_foodsafety_rows_product_name ON public.foodsafety_rows USING gin (product_name gin_trgm_ops);
CREATE INDEX idx_foodsafety_rows_raw_material ON public.foodsafety_rows USING gin (raw_material_name gin_trgm_ops);
CREATE UNIQUE INDEX idx_customer_products_link ON public.customer_products USING btree (customer_id, api_code, report_no) WHERE (source = 'foodsafety'::text);
CREATE UNIQUE INDEX idx_product_recommendations_unique ON public.product_recommendations USING btree (customer_id, ingredient_id, api_code, report_no) WHERE ((api_code IS NOT NULL) AND (report_no IS NOT NULL));
