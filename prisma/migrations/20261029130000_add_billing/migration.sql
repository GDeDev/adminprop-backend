-- Cuotas, cargos, pagos, detalle diario de punitorios, ajustes y saldos a favor
-- (Fase 11, rediseño sección 3; D-71 a D-78).

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "ChargeConcept" AS ENUM ('SERVICE', 'TERMINATION_PENALTY', 'OTHER');

-- CreateEnum
CREATE TYPE "ExchangeRateSource" AS ENUM ('OFFICIAL', 'MEP', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('CASH_IN', 'CREDIT_APPLICATION');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('TRANSFER', 'CASH', 'CREDIT', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentReceiver" AS ENUM ('AGENCY', 'OWNER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'VOIDED');

-- CreateEnum
CREATE TYPE "LateFeeAdjustmentKind" AS ENUM ('REDUCE', 'WAIVE');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('AVAILABLE', 'APPLIED', 'REFUNDED', 'VOIDED');

-- CreateTable
CREATE TABLE "installments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "renter_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "base_amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "grace_end_date" DATE NOT NULL,
    "late_fee_percentage" DECIMAL(5,2) NOT NULL,
    "late_fee_grace_days" INTEGER NOT NULL,
    "collection_mode" "CollectionMode" NOT NULL,
    "fee_mode" "FeeMode" NOT NULL,
    "fee_percentage" DECIMAL(5,2) NOT NULL,
    "fee_amount" DECIMAL(14,2),
    "late_fee_waived" BOOLEAN NOT NULL DEFAULT false,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_charges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "installment_id" UUID NOT NULL,
    "concept" "ChargeConcept" NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "installment_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "installment_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "renter_id" UUID NOT NULL,
    "paid_at" DATE NOT NULL,
    "paid_currency" "Currency" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "exchange_rate" DECIMAL(14,4),
    "exchange_rate_source" "ExchangeRateSource",
    "exchange_rate_date" DATE,
    "amount_in_contract_currency" DECIMAL(14,2) NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "received_by" "PaymentReceiver" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "late_fee_applied" DECIMAL(14,2) NOT NULL,
    "rent_applied" DECIMAL(14,2) NOT NULL,
    "charges_applied" DECIMAL(14,2) NOT NULL,
    "credit_generated" DECIMAL(14,2) NOT NULL,
    "credit_id" UUID,
    "receipt_key" VARCHAR(500),
    "receipt_url" VARCHAR(1000),
    "registered_by_id" UUID NOT NULL,
    "notes" TEXT,
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_late_fee_days" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "installment_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "day_number" INTEGER NOT NULL,
    "outstanding_base" DECIMAL(14,2) NOT NULL,
    "daily_percentage" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "installment_late_fee_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "late_fee_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "installment_id" UUID NOT NULL,
    "kind" "LateFeeAdjustmentKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "late_fee_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renter_credits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "renter_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "remaining" DECIMAL(14,2) NOT NULL,
    "origin_payment_id" UUID NOT NULL,
    "status" "CreditStatus" NOT NULL DEFAULT 'AVAILABLE',
    "refunded_at" DATE,
    "refund_method" "PaymentMethod",
    "refunded_by_id" UUID,
    "refund_notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "renter_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "installments_tenant_id_period_status_idx" ON "installments"("tenant_id", "period", "status");

-- CreateIndex
CREATE INDEX "installments_tenant_id_status_grace_end_date_idx" ON "installments"("tenant_id", "status", "grace_end_date");

-- CreateIndex
CREATE INDEX "installments_tenant_id_renter_id_status_idx" ON "installments"("tenant_id", "renter_id", "status");

-- CreateIndex
CREATE INDEX "installments_tenant_id_property_id_idx" ON "installments"("tenant_id", "property_id");

-- CreateIndex
CREATE INDEX "installments_tenant_id_owner_id_idx" ON "installments"("tenant_id", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "installments_tenant_id_contract_id_period_key" ON "installments"("tenant_id", "contract_id", "period");

-- CreateIndex
CREATE INDEX "installment_charges_tenant_id_installment_id_idx" ON "installment_charges"("tenant_id", "installment_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_installment_id_idx" ON "payments"("tenant_id", "installment_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_contract_id_paid_at_idx" ON "payments"("tenant_id", "contract_id", "paid_at");

-- CreateIndex
CREATE INDEX "payments_tenant_id_renter_id_idx" ON "payments"("tenant_id", "renter_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_status_received_by_idx" ON "payments"("tenant_id", "status", "received_by");

-- CreateIndex
CREATE INDEX "payments_tenant_id_credit_id_idx" ON "payments"("tenant_id", "credit_id");

-- CreateIndex
CREATE INDEX "installment_late_fee_days_tenant_id_installment_id_idx" ON "installment_late_fee_days"("tenant_id", "installment_id");

-- CreateIndex
CREATE UNIQUE INDEX "installment_late_fee_days_installment_id_day_number_key" ON "installment_late_fee_days"("installment_id", "day_number");

-- CreateIndex
CREATE INDEX "late_fee_adjustments_tenant_id_installment_id_idx" ON "late_fee_adjustments"("tenant_id", "installment_id");

-- CreateIndex
CREATE INDEX "renter_credits_tenant_id_renter_id_status_idx" ON "renter_credits"("tenant_id", "renter_id", "status");

-- CreateIndex
CREATE INDEX "renter_credits_tenant_id_contract_id_idx" ON "renter_credits"("tenant_id", "contract_id");

-- CreateIndex
CREATE INDEX "renter_credits_tenant_id_origin_payment_id_idx" ON "renter_credits"("tenant_id", "origin_payment_id");

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_charges" ADD CONSTRAINT "installment_charges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_charges" ADD CONSTRAINT "installment_charges_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_late_fee_days" ADD CONSTRAINT "installment_late_fee_days_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_late_fee_days" ADD CONSTRAINT "installment_late_fee_days_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_adjustments" ADD CONSTRAINT "late_fee_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_adjustments" ADD CONSTRAINT "late_fee_adjustments_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renter_credits" ADD CONSTRAINT "renter_credits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
