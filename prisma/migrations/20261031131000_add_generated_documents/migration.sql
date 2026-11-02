-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('SETTLEMENT', 'OWNER_STATEMENT', 'PAYMENT_RECEIPT', 'TERMINATION_NOTICE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "termination_pdf_key" VARCHAR(500),
ADD COLUMN     "termination_pdf_url" VARCHAR(1000);

-- AlterTable
ALTER TABLE "owner_statements" ADD COLUMN     "pdf_key" VARCHAR(500),
ADD COLUMN     "pdf_url" VARCHAR(1000);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "receipt_number" VARCHAR(20),
ADD COLUMN     "receipt_pdf_key" VARCHAR(500),
ADD COLUMN     "receipt_pdf_url" VARCHAR(1000);

-- AlterTable
ALTER TABLE "settlements" ADD COLUMN     "pdf_key" VARCHAR(500),
ADD COLUMN     "pdf_url" VARCHAR(1000);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "entity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "storage_key" VARCHAR(500),
    "url" VARCHAR(1000),
    "size_bytes" INTEGER,
    "error" TEXT,
    "generated_at" TIMESTAMPTZ(3),
    "requested_by_id" UUID,
    "data_snapshot" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generated_documents_tenant_id_kind_entity_id_status_idx" ON "generated_documents"("tenant_id", "kind", "entity_id", "status");

-- CreateIndex
CREATE INDEX "generated_documents_tenant_id_status_created_at_idx" ON "generated_documents"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_tenant_id_kind_entity_id_version_key" ON "generated_documents"("tenant_id", "kind", "entity_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_receipt_number_key" ON "payments"("tenant_id", "receipt_number");

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

