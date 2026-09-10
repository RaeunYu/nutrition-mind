-- 이슈 #28: 고객 이름 마스킹·암호화 제외(식별 용이성) — 평문 name 칼럼 복원(백필은 앱 복호화 스크립트로 수행)
ALTER TABLE customers ADD COLUMN name text;
