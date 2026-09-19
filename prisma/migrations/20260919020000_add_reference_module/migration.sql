-- CreateTable
CREATE TABLE "example_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "attachment_key" VARCHAR(500),
    "attachment_url" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_by_id" UUID,

    CONSTRAINT "example_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "example_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "example_item_id" UUID NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "example_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "example_items_tenant_id_deleted_at_idx" ON "example_items"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "example_items_tenant_id_name_key" ON "example_items"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "example_activities_tenant_id_example_item_id_idx" ON "example_activities"("tenant_id", "example_item_id");

-- AddForeignKey
ALTER TABLE "example_items" ADD CONSTRAINT "example_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "example_activities" ADD CONSTRAINT "example_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

