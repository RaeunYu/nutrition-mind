-- nutrition-mind 초기 스키마 (project-background-context.md 1장·스키마 방향 반영)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 법령 조문 (조문 1개 = 청크 1개) ─────────────────────────
CREATE TABLE legal_provisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  law_name      text NOT NULL,
  law_type      text NOT NULL CHECK (law_type IN
    ('law','enforcement_decree','enforcement_rule','administrative_rule','referenced_external')),
  article_no    text NOT NULL,
  article_title text,
  content       text NOT NULL,
  promulgation_date date,
  effective_date    date,
  embedding     vector(1024),          -- qwen3-embedding:0.6b (dim=1024)
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (law_name, article_no)
);
CREATE INDEX idx_legal_provisions_law ON legal_provisions (law_name);
-- 벡터 인덱스는 데이터 적재 후 생성 권장 (Task #4)

-- ── 조문 참조 관계 (위임/인용 엣지) ─────────────────────────
CREATE TABLE provision_references (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_provision_id  uuid NOT NULL REFERENCES legal_provisions(id) ON DELETE CASCADE,
  to_provision_id    uuid NOT NULL REFERENCES legal_provisions(id) ON DELETE CASCADE,
  reference_type     text NOT NULL CHECK (reference_type IN ('delegates_to','cites')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_provision_id, to_provision_id, reference_type)
);

-- ── 식약처 데이터: 구조화 적재 + total_count 증분 감지 ────────
CREATE TABLE foodsafety_rows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_code    text NOT NULL,              -- I-0050 / I-0040 / I0030 / C003 / notified_functionality
  payload     jsonb NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_foodsafety_rows_api ON foodsafety_rows (api_code);

-- 품목제조신고류(C003·I0030) 정규화 칼럼 — payload에서 추출·백필 (이슈 #12)
ALTER TABLE foodsafety_rows
  ADD COLUMN product_name       text,   -- PRDLST_NM (제품명)
  ADD COLUMN raw_material_name  text,   -- RAWMTRL_NM (원료명)
  ADD COLUMN functionality_text text,   -- PRIMARY_FNCLTY (기능성 문구)
  ADD COLUMN report_no          text;   -- PRDLST_REPORT_NO (신고번호)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- ILIKE 부분일치 검색용 trgm GIN 인덱스
CREATE INDEX idx_foodsafety_rows_product_name ON foodsafety_rows USING gin (product_name gin_trgm_ops);
CREATE INDEX idx_foodsafety_rows_raw_material ON foodsafety_rows USING gin (raw_material_name gin_trgm_ops);
-- 신고번호 연결 조회(#15 섭취 제품 연결)용
CREATE INDEX idx_foodsafety_rows_report_no    ON foodsafety_rows (report_no);

CREATE TABLE sync_state (
  api_code    text PRIMARY KEY,
  total_count bigint NOT NULL DEFAULT 0,   -- 증분 감지 기준값
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 웹 데모: JWT 로그인 + 역할·고객:성분 1:N 시딩 ─────────────
-- 간소화 RBAC (ADR-0001): Role 테이블 + 가드·데코레이터
CREATE TABLE roles (
  role_id text PRIMARY KEY CHECK (role_id IN ('admin','consultant','marketing')),
  label   text NOT NULL                        -- 한국어 역할명 (CONTEXT.md 용어)
);
INSERT INTO roles (role_id, label) VALUES
  ('admin',      '총관리자'),
  ('consultant', '영업·상담 담당자'),
  ('marketing',  '제품기획·마케팅 담당자');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role_id       text NOT NULL REFERENCES roles(role_id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 고객 — 개인식별 필드는 envelope encryption(ADR-0002, 이슈 #13):
--   key_slot : 고객별 데이터 키(DEK)를 마스터 키(KEK)로 AES-256-GCM wrap한 값
--              저장 형식 v1:<nonce_b64>:<ciphertext+tag_b64>
--   *_enc    : DEK로 암호화한 필드 암호문 — 동일 평문도 nonce마다 다르게 저장됨
--   평문 개인식별 필드는 저장하지 않는다. 이름 검색·정렬·중복검사는 서비스 레이어(복호화 비교)가 담당.
CREATE TABLE customers (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_slot  text NOT NULL,
  name_enc  text NOT NULL,
  phone_enc text,
  email_enc text,
  memo_enc  text
);

CREATE TABLE customer_ingredients (
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  ingredient_name text NOT NULL,
  PRIMARY KEY (customer_id, ingredient_name)
);

-- 접근 로그 (ADR-0002, 이슈 #14): 고객 개인정보 노출 화면 접근 기록 — 총관리자만 조회
CREATE TABLE access_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email text NOT NULL,
  actor_role  text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_access_logs_accessed_at ON access_logs (accessed_at DESC);
CREATE INDEX idx_access_logs_customer ON access_logs (customer_id);

-- 고객 섭취 제품 (이슈 #15): 품목제조신고 제품 연결(source=foodsafety, 스냅샷 저장) 또는 수동 등록(source=manual)
CREATE TABLE customer_products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  source       text NOT NULL,
  api_code     text,
  report_no    text,
  product_name text NOT NULL,
  raw_materials text,
  functionality text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_products_customer ON customer_products (customer_id);
CREATE UNIQUE INDEX idx_customer_products_link ON customer_products (customer_id, api_code, report_no) WHERE source = 'foodsafety';
