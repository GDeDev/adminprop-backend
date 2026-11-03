-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('EXCEL', 'TOKKO');

-- CreateEnum
CREATE TYPE "ImportBatchMode" AS ENUM ('DRY_RUN', 'IMPORT');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('ANALYZING', 'READY', 'IMPORTING', 'COMPLETED', 'PARTIAL', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ImportEntity" AS ENUM ('OWNER', 'RENTER', 'GUARANTOR', 'PROPERTY', 'CONTRACT');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'ERROR', 'CONFLICT', 'ALREADY_IMPORTED', 'IMPORTED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportResolution" AS ENUM ('SKIP', 'MERGE_EMPTY_FIELDS');

-- CreateEnum
CREATE TYPE "ImportAssetStatus" AS ENUM ('PENDING', 'MIGRATED', 'FAILED');

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "needs_review" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "source" "ImportSource" NOT NULL,
    "mode" "ImportBatchMode" NOT NULL DEFAULT 'DRY_RUN',
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'ANALYZING',
    "file_name" VARCHAR(255),
    "file_key" VARCHAR(500),
    "analysis_job_id" UUID,
    "import_job_id" UUID,
    "summary" JSONB,
    "options" JSONB,
    "error_message" VARCHAR(500),
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "entity" "ImportEntity" NOT NULL,
    "row_number" INTEGER,
    "external_id" VARCHAR(100),
    "natural_key" VARCHAR(300) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "status" "ImportRowStatus" NOT NULL,
    "data" JSONB NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "conflict" JSONB,
    "resolution" "ImportResolution",
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "target_id" UUID,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "source" "ImportSource" NOT NULL,
    "entity" "ImportEntity" NOT NULL,
    "external_key" VARCHAR(300) NOT NULL,
    "target_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_asset_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "source_url" VARCHAR(1000) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportAssetStatus" NOT NULL DEFAULT 'PENDING',
    "error" VARCHAR(300),
    "storage_key" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_asset_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_tenant_id_created_at_idx" ON "import_batches"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "import_batches_tenant_id_status_idx" ON "import_batches"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "import_batches_tenant_id_source_status_idx" ON "import_batches"("tenant_id", "source", "status");

-- CreateIndex
CREATE INDEX "import_rows_batch_id_entity_status_idx" ON "import_rows"("batch_id", "entity", "status");

-- CreateIndex
CREATE INDEX "import_rows_batch_id_entity_row_number_idx" ON "import_rows"("batch_id", "entity", "row_number");

-- CreateIndex
CREATE INDEX "import_rows_tenant_id_batch_id_idx" ON "import_rows"("tenant_id", "batch_id");

-- CreateIndex
CREATE INDEX "import_links_tenant_id_batch_id_idx" ON "import_links"("tenant_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_links_tenant_id_source_entity_external_key_key" ON "import_links"("tenant_id", "source", "entity", "external_key");

-- CreateIndex
CREATE INDEX "import_asset_results_batch_id_status_idx" ON "import_asset_results"("batch_id", "status");

-- CreateIndex
CREATE INDEX "import_asset_results_batch_id_property_id_idx" ON "import_asset_results"("batch_id", "property_id");

-- CreateIndex
CREATE INDEX "properties_tenant_id_needs_review_idx" ON "properties"("tenant_id", "needs_review");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_links" ADD CONSTRAINT "import_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_asset_results" ADD CONSTRAINT "import_asset_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_asset_results" ADD CONSTRAINT "import_asset_results_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

