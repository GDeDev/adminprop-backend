-- Contratos de alquiler (Fase 9).

-- CreateEnum
CREATE TYPE "RentUpdateType" AS ENUM ('ICL', 'IPC', 'FIXED', 'OTHER');

-- CreateEnum
CREATE TYPE "RentUpdateFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'FOUR_MONTHLY');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'FINISHED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "RentUpdateSource" AS ENUM ('INITIAL', 'INDEX', 'MANUAL');

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "renter_id" UUID NOT NULL,
    "guarantor_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "initial_rent" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "rent_update_type" "RentUpdateType" NOT NULL,
    "rent_update_frequency" "RentUpdateFrequency" NOT NULL,
    "deposit" DECIMAL(14,2) NOT NULL,
    "fee_percentage" DECIMAL(5,2) NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "contract_pdf_key" VARCHAR(500),
    "contract_pdf_url" VARCHAR(1000),
    "notes" TEXT,
    "has_surety" BOOLEAN NOT NULL DEFAULT false,
    "insurer_name" VARCHAR(150),
    "insurer_alert_email" VARCHAR(255),
    "policy_number" VARCHAR(100),
    "policy_expires_at" DATE,
    "policy_pdf_key" VARCHAR(500),
    "policy_pdf_url" VARCHAR(1000),
    "terminated_at" DATE,
    "termination_notified_at" DATE,
    "termination_penalty" DECIMAL(14,2),
    "termination_future_rent" DECIMAL(14,2),
    "renewed_from_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_rent_updates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "previous_rent" DECIMAL(14,2),
    "new_rent" DECIMAL(14,2) NOT NULL,
    "source" "RentUpdateSource" NOT NULL,
    "index_type" "IndexType",
    "index_from_period" VARCHAR(7),
    "index_to_period" VARCHAR(7),
    "index_from_value" DECIMAL(14,6),
    "index_to_value" DECIMAL(14,6),
    "applied_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_rent_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contracts_tenant_id_status_end_date_idx" ON "contracts"("tenant_id", "status", "end_date");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_property_id_idx" ON "contracts"("tenant_id", "property_id");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_renter_id_idx" ON "contracts"("tenant_id", "renter_id");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_owner_id_idx" ON "contracts"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "contract_rent_updates_tenant_id_contract_id_effective_from_idx" ON "contract_rent_updates"("tenant_id", "contract_id", "effective_from");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_rent_updates" ADD CONSTRAINT "contract_rent_updates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_rent_updates" ADD CONSTRAINT "contract_rent_updates_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Un solo contrato ACTIVO por propiedad (RN-04) y por inquilino (RN-05).
-- Los handlers lo chequean antes con un error propio; estos índices
-- parciales, escritos a mano, frenan a dos altas simultáneas.
CREATE UNIQUE INDEX "contracts_tenant_property_active_key" ON "contracts" ("tenant_id", "property_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "contracts_tenant_renter_active_key" ON "contracts" ("tenant_id", "renter_id") WHERE "status" = 'ACTIVE';
