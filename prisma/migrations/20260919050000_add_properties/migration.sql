-- Propiedades y sus fotos (Fase 6).

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('AVAILABLE', 'RENTED', 'MAINTENANCE');

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "address" VARCHAR(200) NOT NULL,
    "location_id" UUID NOT NULL,
    "property_type_id" UUID NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "owner_id" UUID,
    "amenity_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_by_id" UUID,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "properties_tenant_id_status_idx" ON "properties"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "properties_tenant_id_owner_id_idx" ON "properties"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "properties_tenant_id_property_type_id_idx" ON "properties"("tenant_id", "property_type_id");

-- CreateIndex
CREATE INDEX "properties_tenant_id_deleted_at_idx" ON "properties"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "property_photos_tenant_id_property_id_position_idx" ON "property_photos"("tenant_id", "property_id", "position");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_photos" ADD CONSTRAINT "property_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_photos" ADD CONSTRAINT "property_photos_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Búsqueda por dirección parcial (spec 6: ILIKE '%Corrientes%'): un índice
-- trigram evita recorrer la tabla entera. Está declarado en el schema (índice
-- extendido de Prisma); la extensión pg_trgm se crea acá.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "properties_address_trgm_idx" ON "properties" USING gin ("address" gin_trgm_ops);
