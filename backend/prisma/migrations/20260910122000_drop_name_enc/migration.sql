-- 이슈 #28: 복호화 백필 완료 후 name_enc 칼럼 제거(UNIQUE 복원은 앱 중복검사로 대체 — 기존 결정 유지)
ALTER TABLE customers DROP COLUMN IF EXISTS name_enc;
