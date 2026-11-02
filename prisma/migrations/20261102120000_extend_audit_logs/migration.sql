-- CreateEnum
CREATE TYPE "AuditActorKind" AS ENUM ('USER', 'SYSTEM', 'PORTAL_OWNER', 'PORTAL_RENTER');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN';
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'LOGOUT';
ALTER TYPE "AuditAction" ADD VALUE 'NOTIFICATION_SENT';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_RUN';
ALTER TYPE "AuditAction" ADD VALUE 'EXPORT';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actor_kind" "AuditActorKind" NOT NULL DEFAULT 'USER',
ADD COLUMN     "summary" VARCHAR(300),
ALTER COLUMN "entity_id" DROP NOT NULL;

-- Backfill: las filas viejas sin usuario las escribió un proceso del sistema
-- (seed, jobs). Va antes del trigger, que prohíbe todo UPDATE.
UPDATE "audit_logs" SET "actor_kind" = 'SYSTEM' WHERE "user_id" IS NULL;

-- Listados de la pantalla de auditoría: por inmobiliaria y fecha.
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- Inmutabilidad (Fase 20, A-39): ninguna fila de auditoría se edita ni se borra.
-- El TRUNCATE de los e2e no dispara triggers de fila, así que no los afecta.
CREATE FUNCTION audit_logs_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es inmutable: no se permite % sobre sus filas', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_change();
