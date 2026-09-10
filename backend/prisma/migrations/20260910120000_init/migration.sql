-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "legal_provisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "law_name" TEXT NOT NULL,
    "law_type" TEXT NOT NULL,
    "article_no" TEXT NOT NULL,
    "article_title" TEXT,
    "content" TEXT NOT NULL,
    "promulgation_date" DATE,
    "effective_date" DATE,
    "embedding" vector(1024),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_provisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provision_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "from_provision_id" UUID NOT NULL,
    "to_provision_id" UUID NOT NULL,
    "reference_type" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provision_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foodsafety_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "api_code" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "product_name" TEXT,
    "raw_material_name" TEXT,
    "functionality_text" TEXT,
    "intake_note" TEXT,
    "report_no" TEXT,

    CONSTRAINT "foodsafety_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "api_code" TEXT NOT NULL,
    "total_count" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("api_code")
);

-- CreateTable
CREATE TABLE "roles" (
    "role_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key_slot" TEXT NOT NULL,
    "name_enc" TEXT NOT NULL,
    "phone_enc" TEXT,
    "email_enc" TEXT,
    "memo_enc" TEXT,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "api_code" TEXT,
    "report_no" TEXT,
    "product_name" TEXT NOT NULL,
    "raw_materials" TEXT,
    "functionality" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_ingredients" (
    "customer_id" UUID NOT NULL,
    "ingredient_name" TEXT NOT NULL,

    CONSTRAINT "customer_ingredients_pkey" PRIMARY KEY ("customer_id","ingredient_name")
);

-- CreateTable
CREATE TABLE "access_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_email" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "accessed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "synonyms" TEXT,
    "keywords" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_interests" (
    "customer_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,

    CONSTRAINT "customer_interests_pkey" PRIMARY KEY ("customer_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "product_recommendations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "api_code" TEXT,
    "report_no" TEXT,
    "product_name" TEXT NOT NULL,
    "raw_materials" TEXT,
    "ingredient_name" TEXT NOT NULL,
    "evidence_keyword" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_legal_provisions_law" ON "legal_provisions"("law_name");

-- CreateIndex
CREATE UNIQUE INDEX "legal_provisions_law_name_article_no_key" ON "legal_provisions"("law_name", "article_no");

-- CreateIndex
CREATE UNIQUE INDEX "provision_references_from_provision_id_to_provision_id_refe_key" ON "provision_references"("from_provision_id", "to_provision_id", "reference_type");

-- CreateIndex
CREATE INDEX "idx_foodsafety_rows_api" ON "foodsafety_rows"("api_code");

-- CreateIndex
CREATE INDEX "idx_foodsafety_rows_report_no" ON "foodsafety_rows"("report_no");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "customer_products_customer_id_idx" ON "customer_products"("customer_id");

-- CreateIndex
CREATE INDEX "access_logs_accessed_at_idx" ON "access_logs"("accessed_at" DESC);

-- CreateIndex
CREATE INDEX "access_logs_customer_id_idx" ON "access_logs"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");

-- CreateIndex
CREATE INDEX "idx_product_recommendations_customer" ON "product_recommendations"("customer_id");

-- CreateIndex
CREATE INDEX "idx_product_recommendations_ingredient" ON "product_recommendations"("ingredient_id");

-- AddForeignKey
ALTER TABLE "provision_references" ADD CONSTRAINT "provision_references_from_provision_id_fkey" FOREIGN KEY ("from_provision_id") REFERENCES "legal_provisions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "provision_references" ADD CONSTRAINT "provision_references_to_provision_id_fkey" FOREIGN KEY ("to_provision_id") REFERENCES "legal_provisions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_products" ADD CONSTRAINT "customer_products_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ingredients" ADD CONSTRAINT "customer_ingredients_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_interests" ADD CONSTRAINT "customer_interests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customer_interests" ADD CONSTRAINT "customer_interests_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_recommendations" ADD CONSTRAINT "product_recommendations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recommendations" ADD CONSTRAINT "product_recommendations_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

