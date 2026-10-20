-- Servicios por propiedad/contrato y gastos adelantados (Fase 10).

-- CreateEnum
CREATE TYPE "ServicePayer" AS ENUM ('RENTER', 'OWNER');

-- CreateTable
CREATE TABLE "property_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "contract_id" UUID,
    "service_type_id" UUID NOT NULL,
    "paid_by" "ServicePayer" NOT NULL,
    "currency" "Currency" NOT NULL,
    "has_due_date" BOOLEAN NOT NULL DEFAULT false,
    "due_date" DATE,
    "has_increase" BOOLEAN NOT NULL DEFAULT false,
    "increase_frequency" "RentUpdateFrequency",
    "managed_by_agency" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_by_id" UUID,

    CONSTRAINT "property_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "renter_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "expense_date" DATE NOT NULL,
    "receipt_key" VARCHAR(500) NOT NULL,
    "receipt_url" VARCHAR(1000) NOT NULL,
    "settlement_id" UUID,
    "settled_at" TIMESTAMPTZ(3),
    "registered_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_by_id" UUID,

    CONSTRAINT "advance_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_services_tenant_id_property_id_idx" ON "property_services"("tenant_id", "property_id");

-- CreateIndex
CREATE INDEX "property_services_tenant_id_contract_id_idx" ON "property_services"("tenant_id", "contract_id");

-- CreateIndex
CREATE INDEX "property_services_tenant_id_has_due_date_due_date_idx" ON "property_services"("tenant_id", "has_due_date", "due_date");

-- CreateIndex
CREATE INDEX "property_services_tenant_id_deleted_at_idx" ON "property_services"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "advance_expenses_tenant_id_contract_id_settlement_id_idx" ON "advance_expenses"("tenant_id", "contract_id", "settlement_id");

-- CreateIndex
CREATE INDEX "advance_expenses_tenant_id_deleted_at_idx" ON "advance_expenses"("tenant_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "property_services" ADD CONSTRAINT "property_services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_expenses" ADD CONSTRAINT "advance_expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
