-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('ARS', 'USD');

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'EMPLOYEE', 'OWNER', 'RENTER');
ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
COMMIT;

-- DropIndex
DROP INDEX "audit_logs_creado_en_idx";

-- DropIndex
DROP INDEX "audit_logs_entidad_entidad_id_idx";

-- DropIndex
DROP INDEX "audit_logs_usuario_id_idx";

-- AlterTable
ALTER TABLE "audit_logs" DROP COLUMN "accion",
DROP COLUMN "cambios",
DROP COLUMN "creado_en",
DROP COLUMN "entidad",
DROP COLUMN "entidad_id",
DROP COLUMN "usuario_email",
DROP COLUMN "usuario_id",
ADD COLUMN     "action" "AuditAction" NOT NULL,
ADD COLUMN     "changes" JSONB,
ADD COLUMN     "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "entity" VARCHAR(64) NOT NULL,
ADD COLUMN     "entity_id" VARCHAR(64) NOT NULL,
ADD COLUMN     "tenant_id" UUID,
ADD COLUMN     "user_email" VARCHAR(255),
ADD COLUMN     "user_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tenant_id" UUID NOT NULL,
ALTER COLUMN "role" DROP DEFAULT;

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "logo_url" VARCHAR(500),
    "primary_color" VARCHAR(9),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "standard_fee_percentage" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "reduced_fee_percentage" DECIMAL(5,2) NOT NULL DEFAULT 3,
    "reduced_fee_threshold" INTEGER NOT NULL DEFAULT 3,
    "payment_grace_days" INTEGER NOT NULL DEFAULT 10,
    "daily_late_fee_percentage" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "installment_generation_day" INTEGER NOT NULL DEFAULT 28,
    "payment_reminder_day" INTEGER NOT NULL DEFAULT 1,
    "contract_expiry_notice_days" INTEGER NOT NULL DEFAULT 60,
    "monthly_report_day" INTEGER NOT NULL DEFAULT 10,
    "default_currency" "Currency" NOT NULL DEFAULT 'ARS',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_entity_id_idx" ON "audit_logs"("tenant_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

