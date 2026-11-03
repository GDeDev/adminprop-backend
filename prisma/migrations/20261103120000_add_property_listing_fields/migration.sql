-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "listing_currency" "Currency" NOT NULL DEFAULT 'ARS',
ADD COLUMN     "listing_price" DECIMAL(14,2),
ADD COLUMN     "public_description" VARCHAR(2000);

-- CreateIndex
CREATE INDEX "properties_tenant_id_status_created_at_idx" ON "properties"("tenant_id", "status", "created_at");
