-- Pagos liquidables y devolución del depósito (Fase 12, rediseño 2.2): el pago
-- recuerda la liquidación que lo incluyó, `DEPOSIT` como medio de pago para la
-- deuda cubierta con el depósito, y la devolución con deducciones (A-13).

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'DEPOSIT';

-- CreateEnum
CREATE TYPE "DepositDeductionConcept" AS ENUM ('DEBT', 'DAMAGE', 'OTHER');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "settlement_id" UUID;

-- CreateTable
CREATE TABLE "deposit_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "returned_at" DATE NOT NULL,
    "deposit_amount" DECIMAL(14,2) NOT NULL,
    "deposit_currency" "Currency" NOT NULL,
    "returned_amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "notes" TEXT,
    "registered_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "deposit_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_return_deductions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "deposit_return_id" UUID NOT NULL,
    "concept" "DepositDeductionConcept" NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "installment_id" UUID,
    "payment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_return_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_tenant_id_settlement_id_idx" ON "payments"("tenant_id", "settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_returns_tenant_id_contract_id_key" ON "deposit_returns"("tenant_id", "contract_id");

-- CreateIndex
CREATE INDEX "deposit_return_deductions_tenant_id_deposit_return_id_idx" ON "deposit_return_deductions"("tenant_id", "deposit_return_id");

-- AddForeignKey
ALTER TABLE "deposit_returns" ADD CONSTRAINT "deposit_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_return_deductions" ADD CONSTRAINT "deposit_return_deductions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_return_deductions" ADD CONSTRAINT "deposit_return_deductions_deposit_return_id_fkey" FOREIGN KEY ("deposit_return_id") REFERENCES "deposit_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
