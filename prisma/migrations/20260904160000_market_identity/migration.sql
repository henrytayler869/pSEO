-- DropForeignKey
ALTER TABLE "DataPoint" DROP CONSTRAINT "DataPoint_marketId_fkey";

-- DropForeignKey
ALTER TABLE "KeywordMetric" DROP CONSTRAINT "KeywordMetric_marketId_fkey";

-- DropForeignKey
ALTER TABLE "MarketScore" DROP CONSTRAINT "MarketScore_marketId_fkey";

-- DropForeignKey
ALTER TABLE "Page" DROP CONSTRAINT "Page_marketId_fkey";

-- DropForeignKey
ALTER TABLE "ValidationFlag" DROP CONSTRAINT "ValidationFlag_marketId_fkey";

-- DropIndex
DROP INDEX "DataPoint_marketId_metric_idx";

-- DropIndex
DROP INDEX "KeywordMetric_marketId_idx";

-- DropIndex
DROP INDEX "Market_vertical_idx";

-- DropIndex
DROP INDEX "Market_zip_idx";

-- DropIndex
DROP INDEX "Market_zip_vertical_coverageImportId_key";

-- DropIndex
DROP INDEX "MarketScore_marketId_idx";

-- DropIndex
DROP INDEX "MarketScore_marketId_version_key";

-- DropIndex
DROP INDEX "Page_marketId_idx";

-- DropIndex
DROP INDEX "ValidationFlag_marketId_idx";

-- AlterTable
ALTER TABLE "DataPoint" DROP COLUMN "marketId",
ADD COLUMN     "marketIdentityId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "KeywordMetric" DROP COLUMN "marketId",
ADD COLUMN     "marketIdentityId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Market" DROP COLUMN "city",
DROP COLUMN "state",
DROP COLUMN "vertical",
DROP COLUMN "zip",
ADD COLUMN     "marketIdentityId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MarketScore" DROP COLUMN "marketId",
ADD COLUMN     "marketIdentityId" TEXT NOT NULL,
ADD COLUMN     "sourceMarketId" TEXT;

-- AlterTable
ALTER TABLE "Page" DROP COLUMN "marketId",
ADD COLUMN     "marketIdentityId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ValidationFlag" DROP COLUMN "marketId",
ADD COLUMN     "marketIdentityId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "MarketIdentity" (
    "id" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketIdentity_vertical_idx" ON "MarketIdentity"("vertical");

-- CreateIndex
CREATE INDEX "MarketIdentity_zip_idx" ON "MarketIdentity"("zip");

-- CreateIndex
CREATE UNIQUE INDEX "MarketIdentity_zip_vertical_key" ON "MarketIdentity"("zip", "vertical");

-- CreateIndex
CREATE INDEX "DataPoint_marketIdentityId_metric_idx" ON "DataPoint"("marketIdentityId", "metric");

-- CreateIndex
CREATE INDEX "KeywordMetric_marketIdentityId_idx" ON "KeywordMetric"("marketIdentityId");

-- CreateIndex
CREATE INDEX "Market_coverageImportId_idx" ON "Market"("coverageImportId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_marketIdentityId_coverageImportId_key" ON "Market"("marketIdentityId", "coverageImportId");

-- CreateIndex
CREATE INDEX "MarketScore_marketIdentityId_idx" ON "MarketScore"("marketIdentityId");

-- CreateIndex
CREATE INDEX "MarketScore_sourceMarketId_idx" ON "MarketScore"("sourceMarketId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketScore_marketIdentityId_version_key" ON "MarketScore"("marketIdentityId", "version");

-- CreateIndex
CREATE INDEX "Page_marketIdentityId_idx" ON "Page"("marketIdentityId");

-- CreateIndex
CREATE INDEX "ValidationFlag_marketIdentityId_idx" ON "ValidationFlag"("marketIdentityId");

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_marketIdentityId_fkey" FOREIGN KEY ("marketIdentityId") REFERENCES "MarketIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordMetric" ADD CONSTRAINT "KeywordMetric_marketIdentityId_fkey" FOREIGN KEY ("marketIdentityId") REFERENCES "MarketIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketScore" ADD CONSTRAINT "MarketScore_marketIdentityId_fkey" FOREIGN KEY ("marketIdentityId") REFERENCES "MarketIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketScore" ADD CONSTRAINT "MarketScore_sourceMarketId_fkey" FOREIGN KEY ("sourceMarketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataPoint" ADD CONSTRAINT "DataPoint_marketIdentityId_fkey" FOREIGN KEY ("marketIdentityId") REFERENCES "MarketIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationFlag" ADD CONSTRAINT "ValidationFlag_marketIdentityId_fkey" FOREIGN KEY ("marketIdentityId") REFERENCES "MarketIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_marketIdentityId_fkey" FOREIGN KEY ("marketIdentityId") REFERENCES "MarketIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

