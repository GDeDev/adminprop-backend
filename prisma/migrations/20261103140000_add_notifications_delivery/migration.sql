-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED', 'DELAYED');

-- AlterTable
ALTER TABLE "notification_log" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "next_attempt_at" TIMESTAMPTZ(3),
ADD COLUMN     "provider_message_id" VARCHAR(100),
ADD COLUMN     "skip_reason" VARCHAR(40),
ADD COLUMN     "subject" VARCHAR(200),
ADD COLUMN     "template_key" VARCHAR(60);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "body_text" TEXT NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "channels" "NotificationChannel"[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_user_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "email_enabled" BOOLEAN NOT NULL,
    "in_app_enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "notification_id" UUID,
    "provider_message_id" VARCHAR(100) NOT NULL,
    "event_type" "EmailEventType" NOT NULL,
    "recipient_email" VARCHAR(255),
    "payload_raw" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_tenant_id_key_key" ON "notification_templates"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_tenant_id_type_key" ON "notification_settings"("tenant_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "notification_user_preferences_tenant_id_user_id_type_key" ON "notification_user_preferences"("tenant_id", "user_id", "type");

-- CreateIndex
CREATE INDEX "email_events_tenant_id_notification_id_idx" ON "email_events"("tenant_id", "notification_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_events_provider_message_id_event_type_key" ON "email_events"("provider_message_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_tenant_id_key_key" ON "whatsapp_templates"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "notification_log_provider_message_id_idx" ON "notification_log"("provider_message_id");

-- CreateIndex
CREATE INDEX "notification_log_tenant_id_status_created_at_idx" ON "notification_log"("tenant_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_user_preferences" ADD CONSTRAINT "notification_user_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

