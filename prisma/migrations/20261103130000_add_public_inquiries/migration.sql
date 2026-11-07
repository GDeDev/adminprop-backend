-- CreateEnum
CREATE TYPE "PublicInquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PublicInquirySource" AS ENUM ('PORTAL');

-- CreateTable
CREATE TABLE "public_inquiries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "property_id" UUID,
    "status" "PublicInquiryStatus" NOT NULL DEFAULT 'NEW',
    "source" "PublicInquirySource" NOT NULL DEFAULT 'PORTAL',
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "public_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_inquiries_tenant_id_status_created_at_idx" ON "public_inquiries"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "public_inquiries_tenant_id_property_id_idx" ON "public_inquiries"("tenant_id", "property_id");

-- CreateIndex
CREATE INDEX "public_inquiries_tenant_id_ip_created_at_idx" ON "public_inquiries"("tenant_id", "ip", "created_at");

-- CreateIndex
CREATE INDEX "public_inquiries_tenant_id_email_created_at_idx" ON "public_inquiries"("tenant_id", "email", "created_at");

-- AddForeignKey
ALTER TABLE "public_inquiries" ADD CONSTRAINT "public_inquiries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

