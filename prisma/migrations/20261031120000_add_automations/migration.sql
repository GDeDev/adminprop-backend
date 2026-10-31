-- CreateEnum
CREATE TYPE "JobExecutionStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "JobTrigger" AS ENUM ('SCHEDULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "NotificationRecipientKind" AS ENUM ('RENTER', 'OWNER', 'TENANT_STAFF', 'INSURER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'WHATSAPP_LINK', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "job_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "job" VARCHAR(60) NOT NULL,
    "scheduled_for" DATE NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "status" "JobExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "affected" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "error" TEXT,
    "details" JSONB,
    "triggered_by" "JobTrigger" NOT NULL DEFAULT 'SCHEDULE',
    "triggered_by_user_id" UUID,

    CONSTRAINT "job_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "recipient_kind" "NotificationRecipientKind" NOT NULL,
    "recipient_id" UUID,
    "recipient_email" VARCHAR(255),
    "entity_type" VARCHAR(40),
    "entity_id" UUID,
    "dedupe_key" VARCHAR(200) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_executions_tenant_id_job_scheduled_for_idx" ON "job_executions"("tenant_id", "job", "scheduled_for");

-- CreateIndex
CREATE INDEX "job_executions_job_started_at_idx" ON "job_executions"("job", "started_at");

-- CreateIndex
CREATE INDEX "notification_log_tenant_id_recipient_kind_channel_created_a_idx" ON "notification_log"("tenant_id", "recipient_kind", "channel", "created_at");

-- CreateIndex
CREATE INDEX "notification_log_tenant_id_entity_type_entity_id_idx" ON "notification_log"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_log_tenant_id_dedupe_key_key" ON "notification_log"("tenant_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "job_executions" ADD CONSTRAINT "job_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

