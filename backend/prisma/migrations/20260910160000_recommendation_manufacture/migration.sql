-- 이슈 #29 — 추천 제안 스냅샷에 업소명·생산종료여부 저장
ALTER TABLE product_recommendations ADD COLUMN manufacturer_name text;
ALTER TABLE product_recommendations ADD COLUMN production_ended text;
