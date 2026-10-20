-- Propietarios (Fase 7).

-- CreateTable
CREATE TABLE "owners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "national_id" VARCHAR(11) NOT NULL,
    "search_name" VARCHAR(201) NOT NULL,
    "phone" VARCHAR(40),
    "email" VARCHAR(255),
    "address" VARCHAR(200),
    "notes" TEXT,
    "bank_cbu" VARCHAR(22),
    "bank_alias" VARCHAR(50),
    "bank_name" VARCHAR(100),
    "bank_holder" VARCHAR(150),
    "portal_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_by_id" UUID,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "owners_tenant_id_last_name_first_name_idx" ON "owners"("tenant_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "owners_tenant_id_bank_cbu_idx" ON "owners"("tenant_id", "bank_cbu");

-- CreateIndex
CREATE INDEX "owners_tenant_id_deleted_at_idx" ON "owners"("tenant_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "owners" ADD CONSTRAINT "owners_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- DNI/CUIT único por inmobiliaria entre los no borrados: un propietario
-- borrado no impide volver a cargarlo. Índice parcial, escrito a mano.
CREATE UNIQUE INDEX "owners_tenant_national_id_key" ON "owners" ("tenant_id", "national_id") WHERE "deleted_at" IS NULL;
