-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."BatchGateStatus" AS ENUM ('OPEN', 'HOLDING', 'PASSED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "public"."FlagSeverity" AS ENUM ('INFO', 'WARN', 'BLOCK');

-- CreateEnum
CREATE TYPE "public"."GeoResolution" AS ENUM ('ZIP', 'COUNTY', 'METRO', 'STATE');

-- CreateEnum
CREATE TYPE "public"."PageStatus" AS ENUM ('DRAFT', 'QA_PENDING', 'QA_FAILED', 'QUEUED', 'PUBLISHED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "public"."PricingModel" AS ENUM ('PER_APPOINTMENT', 'PER_CALL_DURATION', 'CPL');

-- CreateEnum
CREATE TYPE "public"."RecommendationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED');

-- CreateEnum
CREATE TYPE "public"."RecommendationType" AS ENUM ('TITLE_REWRITE', 'CONTENT_EXPANSION', 'INTERNAL_LINK', 'WITHDRAW_CANDIDATE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."SnapshotStatus" AS ENUM ('OK', 'SUSPECT', 'FAILED');

-- CreateTable
CREATE TABLE "public"."AiSpendRecord" (
    "id" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "batchApiCallCount" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSpendRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AppConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Boilerplate" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Boilerplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CoverageImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "CoverageImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DataPoint" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "resolvedAtResolution" "public"."GeoResolution" NOT NULL,
    "isInferred" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DataSnapshot" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL,
    "status" "public"."SnapshotStatus" NOT NULL DEFAULT 'OK',
    "statusNote" TEXT,

    CONSTRAINT "DataSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DataSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "geoResolution" "public"."GeoResolution" NOT NULL,
    "refreshInterval" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GeoCrosswalk" (
    "id" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "countyFips" TEXT NOT NULL,
    "metro" TEXT,
    "cbsaCode" TEXT,
    "state" TEXT NOT NULL,

    CONSTRAINT "GeoCrosswalk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GscSnapshot" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "isIndexed" BOOLEAN NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "avgPosition" DOUBLE PRECISION NOT NULL,
    "queries" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GscSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."KeywordMetric" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "searchVolume" INTEGER NOT NULL,
    "keywordDifficulty" DOUBLE PRECISION NOT NULL,
    "cpc" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Market" (
    "id" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "payoutFloor" DOUBLE PRECISION NOT NULL,
    "pricingModel" "public"."PricingModel" NOT NULL,
    "isFlatRate" BOOLEAN NOT NULL,
    "coverageZipCount" INTEGER NOT NULL,
    "sourceRefreshedAt" TIMESTAMP(3) NOT NULL,
    "coverageImportId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MarketScore" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "payoutFloorInput" DOUBLE PRECISION NOT NULL,
    "estConversionRateInput" DOUBLE PRECISION NOT NULL,
    "searchVolumeInput" INTEGER NOT NULL,
    "difficultyIndexInput" DOUBLE PRECISION NOT NULL,
    "formulaVersion" TEXT NOT NULL,

    CONSTRAINT "MarketScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Page" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "dataSnapshotId" TEXT NOT NULL,
    "status" "public"."PageStatus" NOT NULL DEFAULT 'DRAFT',
    "hardTemplateHtml" TEXT NOT NULL,
    "aiInterpretationText" TEXT,
    "boilerplateVersion" TEXT NOT NULL,
    "differentiationScore" DOUBLE PRECISION,
    "qaFailureReason" TEXT,
    "publishBatchId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PublishBatch" (
    "id" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "indexedCount" INTEGER NOT NULL DEFAULT 0,
    "impressionCount" INTEGER NOT NULL DEFAULT 0,
    "gateStatus" "public"."BatchGateStatus" NOT NULL DEFAULT 'OPEN',
    "gateCheckedAt" TIMESTAMP(3),
    "overriddenAt" TIMESTAMP(3),
    "overriddenBy" TEXT,
    "overrideReason" TEXT,

    CONSTRAINT "PublishBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Recommendation" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "type" "public"."RecommendationType" NOT NULL,
    "currentValue" TEXT NOT NULL,
    "proposedValue" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidenceSnapshotId" TEXT NOT NULL,
    "status" "public"."RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ValidationFlag" (
    "id" TEXT NOT NULL,
    "validationRunId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "severity" "public"."FlagSeverity" NOT NULL,
    "rule" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ValidationRun" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalMarkets" INTEGER NOT NULL,
    "blockedMarkets" INTEGER NOT NULL,
    "warnMarkets" INTEGER NOT NULL,
    "blockRate" DOUBLE PRECISION NOT NULL,
    "batchGatePassed" BOOLEAN NOT NULL,

    CONSTRAINT "ValidationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSpendRecord_context_idx" ON "public"."AiSpendRecord"("context" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AppConfig_key_key" ON "public"."AppConfig"("key" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Boilerplate_version_key" ON "public"."Boilerplate"("version" ASC);

-- CreateIndex
CREATE INDEX "CoverageImport_importedAt_idx" ON "public"."CoverageImport"("importedAt" ASC);

-- CreateIndex
CREATE INDEX "DataPoint_marketId_metric_idx" ON "public"."DataPoint"("marketId" ASC, "metric" ASC);

-- CreateIndex
CREATE INDEX "DataPoint_snapshotId_idx" ON "public"."DataPoint"("snapshotId" ASC);

-- CreateIndex
CREATE INDEX "DataSnapshot_sourceId_idx" ON "public"."DataSnapshot"("sourceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DataSnapshot_sourceId_version_key" ON "public"."DataSnapshot"("sourceId" ASC, "version" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_adapterKey_key" ON "public"."DataSource"("adapterKey" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_name_key" ON "public"."DataSource"("name" ASC);

-- CreateIndex
CREATE INDEX "GeoCrosswalk_county_idx" ON "public"."GeoCrosswalk"("county" ASC);

-- CreateIndex
CREATE INDEX "GeoCrosswalk_metro_idx" ON "public"."GeoCrosswalk"("metro" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "GeoCrosswalk_zip_key" ON "public"."GeoCrosswalk"("zip" ASC);

-- CreateIndex
CREATE INDEX "GscSnapshot_date_idx" ON "public"."GscSnapshot"("date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "GscSnapshot_pageId_date_key" ON "public"."GscSnapshot"("pageId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "GscSnapshot_pageId_idx" ON "public"."GscSnapshot"("pageId" ASC);

-- CreateIndex
CREATE INDEX "KeywordMetric_keyword_idx" ON "public"."KeywordMetric"("keyword" ASC);

-- CreateIndex
CREATE INDEX "KeywordMetric_marketId_idx" ON "public"."KeywordMetric"("marketId" ASC);

-- CreateIndex
CREATE INDEX "Market_vertical_idx" ON "public"."Market"("vertical" ASC);

-- CreateIndex
CREATE INDEX "Market_zip_idx" ON "public"."Market"("zip" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Market_zip_vertical_coverageImportId_key" ON "public"."Market"("zip" ASC, "vertical" ASC, "coverageImportId" ASC);

-- CreateIndex
CREATE INDEX "MarketScore_calculatedAt_idx" ON "public"."MarketScore"("calculatedAt" ASC);

-- CreateIndex
CREATE INDEX "MarketScore_marketId_idx" ON "public"."MarketScore"("marketId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MarketScore_marketId_version_key" ON "public"."MarketScore"("marketId" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "Page_marketId_idx" ON "public"."Page"("marketId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Page_slug_key" ON "public"."Page"("slug" ASC);

-- CreateIndex
CREATE INDEX "Page_status_idx" ON "public"."Page"("status" ASC);

-- CreateIndex
CREATE INDEX "PublishBatch_publishedAt_idx" ON "public"."PublishBatch"("publishedAt" ASC);

-- CreateIndex
CREATE INDEX "Recommendation_pageId_idx" ON "public"."Recommendation"("pageId" ASC);

-- CreateIndex
CREATE INDEX "Recommendation_status_idx" ON "public"."Recommendation"("status" ASC);

-- CreateIndex
CREATE INDEX "ValidationFlag_marketId_idx" ON "public"."ValidationFlag"("marketId" ASC);

-- CreateIndex
CREATE INDEX "ValidationFlag_validationRunId_idx" ON "public"."ValidationFlag"("validationRunId" ASC);

-- CreateIndex
CREATE INDEX "ValidationRun_snapshotId_idx" ON "public"."ValidationRun"("snapshotId" ASC);

-- AddForeignKey
ALTER TABLE "public"."DataPoint" ADD CONSTRAINT "DataPoint_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DataPoint" ADD CONSTRAINT "DataPoint_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "public"."DataSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DataSnapshot" ADD CONSTRAINT "DataSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "public"."DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GscSnapshot" ADD CONSTRAINT "GscSnapshot_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "public"."Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."KeywordMetric" ADD CONSTRAINT "KeywordMetric_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Market" ADD CONSTRAINT "Market_coverageImportId_fkey" FOREIGN KEY ("coverageImportId") REFERENCES "public"."CoverageImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MarketScore" ADD CONSTRAINT "MarketScore_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Page" ADD CONSTRAINT "Page_dataSnapshotId_fkey" FOREIGN KEY ("dataSnapshotId") REFERENCES "public"."DataSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Page" ADD CONSTRAINT "Page_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Page" ADD CONSTRAINT "Page_publishBatchId_fkey" FOREIGN KEY ("publishBatchId") REFERENCES "public"."PublishBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Recommendation" ADD CONSTRAINT "Recommendation_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "public"."Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ValidationFlag" ADD CONSTRAINT "ValidationFlag_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ValidationFlag" ADD CONSTRAINT "ValidationFlag_validationRunId_fkey" FOREIGN KEY ("validationRunId") REFERENCES "public"."ValidationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ValidationRun" ADD CONSTRAINT "ValidationRun_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "public"."DataSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

