-- 이슈 #29 — 업소명(BSSH_NM)·생산종료여부(PRODUCTION) 정규화 칼럼 추가 + 백필
ALTER TABLE foodsafety_rows ADD COLUMN manufacturer_name text;
ALTER TABLE foodsafety_rows ADD COLUMN production_ended text;
UPDATE foodsafety_rows
SET manufacturer_name = payload->>'BSSH_NM',
    production_ended = payload->>'PRODUCTION'
WHERE api_code IN ('C003','I0030');
