-- CreateEnum
CREATE TYPE "AsyncJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');

-- CreateTable
CREATE TABLE "async_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "status" "AsyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "started_by_id" UUID,
    "total_items" INTEGER,
    "processed_items" INTEGER NOT NULL DEFAULT 0,
    "failed_items" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "async_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "async_jobs_tenant_id_type_started_at_idx" ON "async_jobs"("tenant_id", "type", "started_at");

-- AddForeignKey
ALTER TABLE "async_jobs" ADD CONSTRAINT "async_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

