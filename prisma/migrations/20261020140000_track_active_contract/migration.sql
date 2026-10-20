-- Fase 9: propiedades e inquilinos saben cuál es su contrato activo sin
-- depender del módulo de contratos, que es quien escribe estas columnas por
-- las facades. Sin FK: módulos distintos (D-51).

-- AlterTable
ALTER TABLE "properties" ADD COLUMN "active_contract_id" UUID,
ADD COLUMN "last_contract_id" UUID;

-- AlterTable
ALTER TABLE "renters" ADD COLUMN "active_contract_id" UUID;

-- CreateIndex
CREATE INDEX "properties_tenant_id_active_contract_id_idx" ON "properties"("tenant_id", "active_contract_id");
