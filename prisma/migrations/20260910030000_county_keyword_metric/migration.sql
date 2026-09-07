-- CreateTable
CREATE TABLE "CountyKeywordMetric" (
    "id" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "countyFips" TEXT NOT NULL,
    "searchPlace" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "searchVolume" INTEGER NOT NULL,
    "keywordDifficulty" DOUBLE PRECISION NOT NULL,
    "cpc" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CountyKeywordMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CountyKeywordMetric_vertical_countyFips_idx" ON "CountyKeywordMetric"("vertical", "countyFips");

-- CreateIndex
CREATE INDEX "CountyKeywordMetric_countyFips_idx" ON "CountyKeywordMetric"("countyFips");

