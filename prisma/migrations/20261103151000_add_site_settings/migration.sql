-- CreateEnum
CREATE TYPE "SiteTemplateKey" AS ENUM ('CLASSIC', 'MODERN');


-- CreateTable
CREATE TABLE "site_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "template_key" "SiteTemplateKey" NOT NULL DEFAULT 'CLASSIC',
    "subdomain" VARCHAR(63),
    "custom_domain" VARCHAR(253),
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "published_at" TIMESTAMPTZ(3),
    "published_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "site_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_settings_tenant_id_key" ON "site_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_settings_subdomain_key" ON "site_settings"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "site_settings_custom_domain_key" ON "site_settings"("custom_domain");

-- CreateIndex
CREATE INDEX "site_assets_tenant_id_url_idx" ON "site_assets"("tenant_id", "url");

-- AddForeignKey
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_assets" ADD CONSTRAINT "site_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

