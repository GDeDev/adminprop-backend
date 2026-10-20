-- Inquilinos y garantes (Fase 8).

-- CreateEnum
CREATE TYPE "GuaranteeType" AS ENUM ('PROPERTY', 'PAYSLIPS');

-- CreateTable
CREATE TABLE "guarantors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "national_id" VARCHAR(11) NOT NULL,
    "search_name" VARCHAR(201) NOT NULL,
    "phone" VARCHAR(40),
    "email" VARCHAR(255),
    "address" VARCHAR(200),
    "guarantee_type" "GuaranteeType" NOT NULL,
    "guarantee_detail" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_by_id" UUID,

    CONSTRAINT "guarantors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "national_id" VARCHAR(11) NOT NULL,
    "search_name" VARCHAR(201) NOT NULL,
    "phone" VARCHAR(40),
    "email" VARCHAR(255),
    "address" VARCHAR(200),
    "move_in_date" DATE,
    "notes" TEXT,
    "guarantor_id" UUID,
    "portal_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_by_id" UUID,

    CONSTRAINT "renters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guarantors_tenant_id_last_name_first_name_idx" ON "guarantors"("tenant_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "guarantors_tenant_id_deleted_at_idx" ON "guarantors"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "renters_tenant_id_last_name_first_name_idx" ON "renters"("tenant_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "renters_tenant_id_guarantor_id_idx" ON "renters"("tenant_id", "guarantor_id");

-- CreateIndex
CREATE INDEX "renters_tenant_id_deleted_at_idx" ON "renters"("tenant_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "guarantors" ADD CONSTRAINT "guarantors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renters" ADD CONSTRAINT "renters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renters" ADD CONSTRAINT "renters_guarantor_id_fkey" FOREIGN KEY ("guarantor_id") REFERENCES "guarantors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- DNI/CUIT único por inmobiliaria entre los no borrados, como en `owners`:
-- un inquilino o garante borrado no impide volver a cargarlo. Índices
-- parciales, escritos a mano.
CREATE UNIQUE INDEX "guarantors_tenant_national_id_key" ON "guarantors" ("tenant_id", "national_id") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "renters_tenant_national_id_key" ON "renters" ("tenant_id", "national_id") WHERE "deleted_at" IS NULL;
