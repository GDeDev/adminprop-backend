-- Fase 23: CRM (consultas ampliadas, actividades, vistas) y multipublicación.

-- CreateEnum
CREATE TYPE "InquiryStage" AS ENUM ('NEW', 'CONTACTED', 'VISIT_SCHEDULED', 'PROPOSAL_SENT', 'CLOSED_WON', 'CLOSED_LOST');

-- CreateEnum
CREATE TYPE "InquiryActivityType" AS ENUM ('CREATED', 'STAGE_CHANGED', 'ASSIGNED', 'NOTE', 'CONTACT_ATTEMPT', 'FOLLOW_UP_SET', 'EDITED');

-- CreateEnum
CREATE TYPE "ListingChannel" AS ENUM ('MERCADOLIBRE', 'ZONAPROP', 'ARGENPROP');

-- CreateEnum
CREATE TYPE "ListingChannelState" AS ENUM ('DISCONNECTED', 'CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ListingState" AS ENUM ('NOT_PUBLISHED', 'PUBLISHING', 'PUBLISHED', 'PAUSED', 'ERROR', 'CLOSED');

-- AlterEnum
ALTER TYPE "PublicInquirySource" ADD VALUE 'MERCADOLIBRE';
ALTER TYPE "PublicInquirySource" ADD VALUE 'ZONAPROP';
ALTER TYPE "PublicInquirySource" ADD VALUE 'ARGENPROP';
ALTER TYPE "PublicInquirySource" ADD VALUE 'WHATSAPP';
ALTER TYPE "PublicInquirySource" ADD VALUE 'PHONE';
ALTER TYPE "PublicInquirySource" ADD VALUE 'MANUAL';

-- AlterTable: columnas nuevas de public_inquiries
ALTER TABLE "public_inquiries"
    ADD COLUMN "stage" "InquiryStage" NOT NULL DEFAULT 'NEW',
    ADD COLUMN "stage_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "board_position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "assigned_to_id" UUID,
    ADD COLUMN "next_action_at" DATE,
    ADD COLUMN "last_contact_at" TIMESTAMPTZ(3),
    ADD COLUMN "lost_reason" VARCHAR(200),
    ADD COLUMN "closed_at" TIMESTAMPTZ(3),
    ADD COLUMN "contract_id" UUID,
    ADD COLUMN "external_id" VARCHAR(120),
    ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

-- Mapeo del estado de la Fase 22 (A-81): CLOSED no dice si se ganó o se perdió.
UPDATE "public_inquiries" SET
    "stage" = CASE "status"::text
        WHEN 'CONTACTED' THEN 'CONTACTED'::"InquiryStage"
        WHEN 'CLOSED' THEN 'CLOSED_LOST'::"InquiryStage"
        ELSE 'NEW'::"InquiryStage"
    END,
    "stage_changed_at" = "updated_at",
    "lost_reason" = CASE WHEN "status"::text = 'CLOSED' THEN 'Migrado de la Fase 22' END,
    "closed_at" = CASE WHEN "status"::text = 'CLOSED' THEN "updated_at" END,
    "last_contact_at" = CASE WHEN "status"::text <> 'NEW' THEN "updated_at" END;

-- Posición inicial: las más nuevas arriba, con holgura (A-82).
UPDATE "public_inquiries" i SET "board_position" = ranked.pos
FROM (
    SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "tenant_id", "stage" ORDER BY "created_at" DESC)) * 1000.0 AS pos
    FROM "public_inquiries"
) ranked
WHERE ranked."id" = i."id";

-- Email y teléfono pasan a ser opcionales (al menos uno).
ALTER TABLE "public_inquiries"
    ALTER COLUMN "email" DROP NOT NULL,
    ALTER COLUMN "phone" DROP NOT NULL,
    ALTER COLUMN "message" SET DEFAULT '';
UPDATE "public_inquiries" SET "phone" = NULL WHERE "phone" = '';
ALTER TABLE "public_inquiries"
    ADD CONSTRAINT "public_inquiries_contact_check" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);

-- Se retira el estado de la Fase 22.
DROP INDEX "public_inquiries_tenant_id_status_created_at_idx";
DROP INDEX "public_inquiries_tenant_id_property_id_idx";
ALTER TABLE "public_inquiries" DROP COLUMN "status";
DROP TYPE "PublicInquiryStatus";

-- CreateIndex
CREATE UNIQUE INDEX "public_inquiries_tenant_id_source_external_id_key" ON "public_inquiries"("tenant_id", "source", "external_id");
CREATE INDEX "public_inquiries_tenant_id_stage_board_position_idx" ON "public_inquiries"("tenant_id", "stage", "board_position");
CREATE INDEX "public_inquiries_tenant_id_assigned_to_id_idx" ON "public_inquiries"("tenant_id", "assigned_to_id");
CREATE INDEX "public_inquiries_tenant_id_next_action_at_idx" ON "public_inquiries"("tenant_id", "next_action_at");
CREATE INDEX "public_inquiries_tenant_id_property_id_created_at_idx" ON "public_inquiries"("tenant_id", "property_id", "created_at");

-- CreateTable
CREATE TABLE "inquiry_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "type" "InquiryActivityType" NOT NULL,
    "author_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_views" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "property_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "channel" "ListingChannel" NOT NULL,
    "status" "ListingChannelState" NOT NULL DEFAULT 'DISCONNECTED',
    "account_label" VARCHAR(200),
    "access_token_enc" TEXT,
    "refresh_token_enc" TEXT,
    "token_expires_at" TIMESTAMPTZ(3),
    "connected_by_id" UUID,
    "connected_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500),
    "last_inquiry_sync_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "listing_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "channel" "ListingChannel" NOT NULL,
    "external_id" VARCHAR(120),
    "external_url" VARCHAR(500),
    "status" "ListingState" NOT NULL DEFAULT 'NOT_PUBLISHED',
    "payload_hash" VARCHAR(64),
    "published_at" TIMESTAMPTZ(3),
    "last_synced_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "property_listings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inquiry_activities_tenant_id_inquiry_id_created_at_idx" ON "inquiry_activities"("tenant_id", "inquiry_id", "created_at");
CREATE UNIQUE INDEX "property_views_tenant_id_property_id_day_key" ON "property_views"("tenant_id", "property_id", "day");
CREATE INDEX "property_views_tenant_id_day_idx" ON "property_views"("tenant_id", "day");
CREATE UNIQUE INDEX "listing_channels_tenant_id_channel_key" ON "listing_channels"("tenant_id", "channel");
CREATE UNIQUE INDEX "property_listings_tenant_id_property_id_channel_key" ON "property_listings"("tenant_id", "property_id", "channel");
CREATE INDEX "property_listings_tenant_id_status_idx" ON "property_listings"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "inquiry_activities" ADD CONSTRAINT "inquiry_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inquiry_activities" ADD CONSTRAINT "inquiry_activities_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "public_inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "property_views" ADD CONSTRAINT "property_views_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "listing_channels" ADD CONSTRAINT "listing_channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
