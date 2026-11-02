-- CreateEnum
CREATE TYPE "InventoryType" AS ENUM ('DELIVERY', 'RETURN');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ItemCondition" AS ENUM ('GOOD', 'FAIR', 'POOR', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "property_inventories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "type" "InventoryType" NOT NULL,
    "date" DATE NOT NULL,
    "status" "InventoryStatus" NOT NULL DEFAULT 'DRAFT',
    "performed_by_id" UUID NOT NULL,
    "tenant_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "general_notes" VARCHAR(2000),
    "confirmed_at" TIMESTAMPTZ(3),
    "confirmed_by_id" UUID,
    "corrects_inventory_id" UUID,
    "correction_reason" VARCHAR(1000),
    "superseded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "property_inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "condition" "ItemCondition" NOT NULL,
    "notes" VARCHAR(1000),
    "position" INTEGER NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_inventories_tenant_id_contract_id_type_idx" ON "property_inventories"("tenant_id", "contract_id", "type");

-- CreateIndex
CREATE INDEX "inventory_items_tenant_id_inventory_id_position_idx" ON "inventory_items"("tenant_id", "inventory_id", "position");

-- CreateIndex
CREATE INDEX "inventory_photos_tenant_id_item_id_position_idx" ON "inventory_photos"("tenant_id", "item_id", "position");

-- CreateIndex
CREATE INDEX "inventory_photos_tenant_id_storage_key_idx" ON "inventory_photos"("tenant_id", "storage_key");

-- AddForeignKey
ALTER TABLE "property_inventories" ADD CONSTRAINT "property_inventories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "property_inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_photos" ADD CONSTRAINT "inventory_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_photos" ADD CONSTRAINT "inventory_photos_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Partial unique indexes (Prisma cannot declare them): one current original
-- inventory per contract and type, and one pending correction per inventory.
CREATE UNIQUE INDEX "property_inventories_current_key" ON "property_inventories" ("tenant_id", "contract_id", "type") WHERE "superseded_by_id" IS NULL AND "corrects_inventory_id" IS NULL;
CREATE UNIQUE INDEX "property_inventories_correction_key" ON "property_inventories" ("corrects_inventory_id") WHERE "corrects_inventory_id" IS NOT NULL;
