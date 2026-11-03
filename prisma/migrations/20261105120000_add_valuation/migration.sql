-- CreateEnum
CREATE TYPE "MarketSource" AS ENUM ('ZONAPROP', 'ARGENPROP', 'MERCADOLIBRE', 'FAKE');

-- CreateEnum
CREATE TYPE "MarketCategory" AS ENUM ('APARTMENT', 'HOUSE', 'PH', 'COMMERCIAL', 'LAND', 'GARAGE', 'OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "MarketOperation" AS ENUM ('RENT');

-- CreateEnum
CREATE TYPE "ValuationConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ValuationEngine" AS ENUM ('STATISTICAL', 'STATISTICAL_LLM');

-- CreateEnum
CREATE TYPE "ZoneRefreshResult" AS ENUM ('OK', 'EMPTY', 'BLOCKED', 'PARSE_ERROR');

-- CreateTable
CREATE TABLE "market_comparables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" "MarketSource" NOT NULL,
    "external_id" VARCHAR(120) NOT NULL,
    "zone_key" VARCHAR(200) NOT NULL,
    "category" "MarketCategory" NOT NULL,
    "operation" "MarketOperation" NOT NULL DEFAULT 'RENT',
    "price" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "area_m2" DECIMAL(10,2),
    "bedrooms" INTEGER,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "url" VARCHAR(1000) NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "market_comparables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_zones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "zone_key" VARCHAR(200) NOT NULL,
    "category" "MarketCategory" NOT NULL,
    "last_refreshed_at" TIMESTAMPTZ(3),
    "last_result" "ZoneRefreshResult",
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "requested_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuation_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_source_states" (
    "source" "MarketSource" NOT NULL,
    "last_run_at" TIMESTAMPTZ(3),
    "last_ingest_at" TIMESTAMPTZ(3),
    "last_result" "ZoneRefreshResult",
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMPTZ(3),

    CONSTRAINT "valuation_source_states_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "valuation_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "input" JSONB NOT NULL,
    "input_hash" VARCHAR(64) NOT NULL,
    "currency" "Currency" NOT NULL,
    "min_price" DECIMAL(14,2) NOT NULL,
    "max_price" DECIMAL(14,2) NOT NULL,
    "suggested_price" DECIMAL(14,2) NOT NULL,
    "confidence" "ValuationConfidence" NOT NULL,
    "comparables_used" INTEGER NOT NULL,
    "comparables_discarded" INTEGER NOT NULL,
    "zone_key_used" VARCHAR(200) NOT NULL,
    "zone_label" VARCHAR(200) NOT NULL,
    "zone_widened" BOOLEAN NOT NULL,
    "oldest_comparable_at" TIMESTAMPTZ(3),
    "engine" "ValuationEngine" NOT NULL,
    "justification" TEXT NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "valuation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "market_comparables_zone_key_category_currency_active_last_s_idx" ON "market_comparables"("zone_key", "category", "currency", "active", "last_seen_at");

-- CreateIndex
CREATE INDEX "market_comparables_active_last_seen_at_idx" ON "market_comparables"("active", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "market_comparables_source_external_id_key" ON "market_comparables"("source", "external_id");

-- CreateIndex
CREATE INDEX "valuation_zones_last_refreshed_at_idx" ON "valuation_zones"("last_refreshed_at");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_zones_zone_key_category_key" ON "valuation_zones"("zone_key", "category");

-- CreateIndex
CREATE INDEX "valuation_requests_tenant_id_property_id_created_at_idx" ON "valuation_requests"("tenant_id", "property_id", "created_at");

-- CreateIndex
CREATE INDEX "valuation_requests_tenant_id_created_at_idx" ON "valuation_requests"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "valuation_requests_tenant_id_property_id_input_hash_created_idx" ON "valuation_requests"("tenant_id", "property_id", "input_hash", "created_at");

-- AddForeignKey
ALTER TABLE "valuation_requests" ADD CONSTRAINT "valuation_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

