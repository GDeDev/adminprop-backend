-- Liquidaciones, consolidados por propietario y cuenta de honorarios
-- (Fase 12, rediseño sección 3; D-82 en adelante).

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'CONFIRMED', 'TRANSFERRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementAdjustmentConcept" AS ENUM ('WITHHOLDING', 'OWNER_ADVANCE', 'OTHER_DEDUCTION', 'OTHER_CREDIT');

-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "FeeReceivableSource" AS ENUM ('OWNER_DIRECT_PAYMENT', 'SETTLEMENT_NOT_DEDUCTED');

-- CreateEnum
CREATE TYPE "FeePayer" AS ENUM ('OWNER', 'RENTER');

-- CreateEnum
CREATE TYPE "FeeReceivableStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'VOIDED');

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "renter_id" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "rent_total" DECIMAL(14,2) NOT NULL,
    "late_fee_total" DECIMAL(14,2) NOT NULL,
    "owner_charges_total" DECIMAL(14,2) NOT NULL,
    "service_charges_total" DECIMAL(14,2) NOT NULL,
    "fee_base" DECIMAL(14,2) NOT NULL,
    "fee_percentage" DECIMAL(5,2) NOT NULL,
    "fee_amount_fixed" DECIMAL(14,2),
    "fee_total" DECIMAL(14,2) NOT NULL,
    "fee_mode" "FeeMode" NOT NULL,
    "fee_deducted" BOOLEAN NOT NULL,
    "mixed_fee_terms" BOOLEAN NOT NULL DEFAULT false,
    "expenses_total" DECIMAL(14,2) NOT NULL,
    "adjustments_total" DECIMAL(14,2) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "transferred_total" DECIMAL(14,2) NOT NULL,
    "statement_id" UUID,
    "has_voided_payments" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at" TIMESTAMPTZ(3),
    "confirmed_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(500),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "installment_id" UUID NOT NULL,
    "installment_period" VARCHAR(7) NOT NULL,
    "paid_at" DATE NOT NULL,
    "rent_applied" DECIMAL(14,2) NOT NULL,
    "late_fee_applied" DECIMAL(14,2) NOT NULL,
    "owner_charges_applied" DECIMAL(14,2) NOT NULL,
    "service_charges_applied" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "expense_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "concept" "SettlementAdjustmentConcept" NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "origin_payment_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "settlement_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "transferred_at" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "receipt_key" VARCHAR(500),
    "receipt_url" VARCHAR(1000),
    "notes" TEXT,
    "registered_by_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "settlement_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_statements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "status" "StatementStatus" NOT NULL DEFAULT 'OPEN',
    "send_mode" "StatementSendMode" NOT NULL,
    "settlements_count" INTEGER NOT NULL DEFAULT 0,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "owner_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_statement_totals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "rent_total" DECIMAL(14,2) NOT NULL,
    "late_fee_total" DECIMAL(14,2) NOT NULL,
    "charges_total" DECIMAL(14,2) NOT NULL,
    "fee_total" DECIMAL(14,2) NOT NULL,
    "expenses_total" DECIMAL(14,2) NOT NULL,
    "adjustments_total" DECIMAL(14,2) NOT NULL,
    "net_total" DECIMAL(14,2) NOT NULL,
    "transferred_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "owner_statement_totals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_receivables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "installment_id" UUID,
    "period" VARCHAR(7) NOT NULL,
    "currency" "Currency" NOT NULL,
    "source" "FeeReceivableSource" NOT NULL,
    "payer" "FeePayer" NOT NULL,
    "origin_payment_id" UUID,
    "origin_settlement_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "FeeReceivableStatus" NOT NULL DEFAULT 'PENDING',
    "fee_percentage" DECIMAL(5,2) NOT NULL,
    "fee_amount_fixed" DECIMAL(14,2),
    "base_amount" DECIMAL(14,2) NOT NULL,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "voided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "fee_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "contract_id" UUID,
    "paid_at" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paid_by" "FeePayer" NOT NULL,
    "unallocated_amount" DECIMAL(14,2) NOT NULL,
    "receipt_key" VARCHAR(500),
    "receipt_url" VARCHAR(1000),
    "notes" TEXT,
    "registered_by_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "fee_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "fee_payment_id" UUID NOT NULL,
    "fee_receivable_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlements_tenant_id_contract_id_period_idx" ON "settlements"("tenant_id", "contract_id", "period");

-- CreateIndex
CREATE INDEX "settlements_tenant_id_owner_id_status_idx" ON "settlements"("tenant_id", "owner_id", "status");

-- CreateIndex
CREATE INDEX "settlements_tenant_id_property_id_idx" ON "settlements"("tenant_id", "property_id");

-- CreateIndex
CREATE INDEX "settlements_tenant_id_status_period_idx" ON "settlements"("tenant_id", "status", "period");

-- CreateIndex
CREATE INDEX "settlements_tenant_id_statement_id_idx" ON "settlements"("tenant_id", "statement_id");

-- CreateIndex
CREATE INDEX "settlement_payments_tenant_id_settlement_id_idx" ON "settlement_payments"("tenant_id", "settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_payments_tenant_id_payment_id_key" ON "settlement_payments"("tenant_id", "payment_id");

-- CreateIndex
CREATE INDEX "settlement_expenses_tenant_id_settlement_id_idx" ON "settlement_expenses"("tenant_id", "settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_expenses_tenant_id_expense_id_key" ON "settlement_expenses"("tenant_id", "expense_id");

-- CreateIndex
CREATE INDEX "settlement_adjustments_tenant_id_settlement_id_idx" ON "settlement_adjustments"("tenant_id", "settlement_id");

-- CreateIndex
CREATE INDEX "settlement_adjustments_tenant_id_origin_payment_id_idx" ON "settlement_adjustments"("tenant_id", "origin_payment_id");

-- CreateIndex
CREATE INDEX "settlement_transfers_tenant_id_settlement_id_idx" ON "settlement_transfers"("tenant_id", "settlement_id");

-- CreateIndex
CREATE INDEX "owner_statements_tenant_id_status_period_idx" ON "owner_statements"("tenant_id", "status", "period");

-- CreateIndex
CREATE UNIQUE INDEX "owner_statements_tenant_id_owner_id_period_key" ON "owner_statements"("tenant_id", "owner_id", "period");

-- CreateIndex
CREATE INDEX "owner_statement_totals_tenant_id_statement_id_idx" ON "owner_statement_totals"("tenant_id", "statement_id");

-- CreateIndex
CREATE UNIQUE INDEX "owner_statement_totals_statement_id_currency_key" ON "owner_statement_totals"("statement_id", "currency");

-- CreateIndex
CREATE INDEX "fee_receivables_tenant_id_owner_id_status_idx" ON "fee_receivables"("tenant_id", "owner_id", "status");

-- CreateIndex
CREATE INDEX "fee_receivables_tenant_id_contract_id_idx" ON "fee_receivables"("tenant_id", "contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_receivables_tenant_id_origin_payment_id_key" ON "fee_receivables"("tenant_id", "origin_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_receivables_tenant_id_origin_settlement_id_key" ON "fee_receivables"("tenant_id", "origin_settlement_id");

-- CreateIndex
CREATE INDEX "fee_payments_tenant_id_owner_id_paid_at_idx" ON "fee_payments"("tenant_id", "owner_id", "paid_at");

-- CreateIndex
CREATE INDEX "fee_payments_tenant_id_contract_id_idx" ON "fee_payments"("tenant_id", "contract_id");

-- CreateIndex
CREATE INDEX "fee_payment_allocations_tenant_id_fee_payment_id_idx" ON "fee_payment_allocations"("tenant_id", "fee_payment_id");

-- CreateIndex
CREATE INDEX "fee_payment_allocations_tenant_id_fee_receivable_id_idx" ON "fee_payment_allocations"("tenant_id", "fee_receivable_id");

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_expenses" ADD CONSTRAINT "settlement_expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_expenses" ADD CONSTRAINT "settlement_expenses_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_transfers" ADD CONSTRAINT "settlement_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_transfers" ADD CONSTRAINT "settlement_transfers_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_statements" ADD CONSTRAINT "owner_statements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_statement_totals" ADD CONSTRAINT "owner_statement_totals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_statement_totals" ADD CONSTRAINT "owner_statement_totals_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "owner_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_receivables" ADD CONSTRAINT "fee_receivables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_payment_allocations" ADD CONSTRAINT "fee_payment_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_payment_allocations" ADD CONSTRAINT "fee_payment_allocations_fee_payment_id_fkey" FOREIGN KEY ("fee_payment_id") REFERENCES "fee_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_payment_allocations" ADD CONSTRAINT "fee_payment_allocations_fee_receivable_id_fkey" FOREIGN KEY ("fee_receivable_id") REFERENCES "fee_receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una sola liquidación PENDING por contrato (4.1): índice único parcial,
-- que Prisma no puede declarar en el schema.
CREATE UNIQUE INDEX "settlements_one_pending_per_contract" ON "settlements"("tenant_id", "contract_id") WHERE "status" = 'PENDING';
