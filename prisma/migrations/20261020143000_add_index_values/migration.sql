-- Índices ICL/IPC (Fase 9). Globales: sin tenant_id (D-54).

-- CreateEnum
CREATE TYPE "IndexType" AS ENUM ('ICL', 'IPC');

-- CreateTable
CREATE TABLE "index_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "index_type" "IndexType" NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "value" DECIMAL(14,6) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "index_values_index_type_period_key" ON "index_values"("index_type", "period");
