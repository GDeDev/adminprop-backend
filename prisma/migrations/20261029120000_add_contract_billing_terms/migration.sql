-- Términos de cobro por contrato como vigencias, modo de devolución y moneda
-- del depósito, % fijo de aumento y frecuencias semestral/anual (Fase 11,
-- rediseño sección 2; D-70).

-- CreateEnum
CREATE TYPE "DepositReturnMode" AS ENUM ('FIXED', 'FOLLOWS_RENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "CollectionMode" AS ENUM ('AGENCY', 'OWNER_DIRECT');

-- CreateEnum
CREATE TYPE "FeeMode" AS ENUM ('DEDUCTED', 'OWNER_PAYS', 'RENTER_PAYS_ON_BEHALF');

-- AlterEnum
ALTER TYPE "RentUpdateFrequency" ADD VALUE 'SEMIANNUAL';
ALTER TYPE "RentUpdateFrequency" ADD VALUE 'ANNUAL';

-- AlterTable
ALTER TABLE "contract_rent_updates" ADD COLUMN     "fixed_percentage" DECIMAL(5,2);

-- AlterTable: la moneda del depósito arranca como la del contrato (backfill),
-- después pasa a obligatoria.
ALTER TABLE "contracts" ADD COLUMN     "deposit_currency" "Currency",
ADD COLUMN     "deposit_return_mode" "DepositReturnMode" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "fixed_increase_percentage" DECIMAL(5,2);

UPDATE "contracts" SET "deposit_currency" = "currency" WHERE "deposit_currency" IS NULL;

ALTER TABLE "contracts" ALTER COLUMN "deposit_currency" SET NOT NULL;

-- CreateTable
CREATE TABLE "contract_billing_terms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "collection_mode" "CollectionMode" NOT NULL,
    "fee_mode" "FeeMode" NOT NULL,
    "fee_percentage" DECIMAL(5,2) NOT NULL,
    "fee_amount" DECIMAL(14,2),
    "late_fee_percentage" DECIMAL(5,2),
    "late_fee_grace_days" INTEGER,
    "notes" TEXT,
    "changed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "contract_billing_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_billing_terms_tenant_id_contract_id_effective_from_idx" ON "contract_billing_terms"("tenant_id", "contract_id", "effective_from");

-- AddForeignKey
ALTER TABLE "contract_billing_terms" ADD CONSTRAINT "contract_billing_terms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_billing_terms" ADD CONSTRAINT "contract_billing_terms_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: cada contrato existente arranca con una fila de términos vigente
-- desde su inicio: cobra la inmobiliaria, honorarios descontados al liquidar
-- con el % fijado al crear (D-57), punitorio heredado del tenant.
INSERT INTO "contract_billing_terms" (
    "tenant_id", "contract_id", "effective_from", "collection_mode", "fee_mode",
    "fee_percentage", "created_at", "updated_at"
)
SELECT
    "tenant_id", "id", "start_date", 'AGENCY', 'DEDUCTED',
    "fee_percentage", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "contracts";
