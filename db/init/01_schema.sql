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

CREATE TABLE customers (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

CREATE TABLE customer_ingredients (
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  ingredient_name text NOT NULL,
  PRIMARY KEY (customer_id, ingredient_name)
);
