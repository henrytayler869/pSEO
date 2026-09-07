-- DropForeignKey
ALTER TABLE "DataPoint" DROP CONSTRAINT "DataPoint_marketIdentityId_fkey";

-- DropForeignKey
ALTER TABLE "ValidationFlag" DROP CONSTRAINT "ValidationFlag_marketIdentityId_fkey";

-- DropIndex
DROP INDEX "DataPoint_marketIdentityId_metric_idx";

-- DropIndex
DROP INDEX "ValidationFlag_marketIdentityId_idx";

-- AlterTable
ALTER TABLE "DataPoint" DROP COLUMN "marketIdentityId",
ADD COLUMN     "locationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ValidationFlag" DROP COLUMN "marketIdentityId",
ADD COLUMN     "locationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ValidationRun" DROP COLUMN "blockedMarkets",
DROP COLUMN "totalMarkets",
DROP COLUMN "warnMarkets",
ADD COLUMN     "blockedLocations" INTEGER NOT NULL,
ADD COLUMN     "totalLocations" INTEGER NOT NULL,
ADD COLUMN     "warnLocations" INTEGER NOT NULL;

-- DropTable
DROP TABLE "GeoCrosswalk";

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT NOT NULL,
    "county" TEXT,
    "countyFips" TEXT,
    "metro" TEXT,
    "cbsaCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_county_idx" ON "Location"("county");

-- CreateIndex
CREATE INDEX "Location_metro_idx" ON "Location"("metro");

-- CreateIndex
CREATE UNIQUE INDEX "Location_zip_key" ON "Location"("zip");

-- CreateIndex
CREATE INDEX "DataPoint_locationId_metric_idx" ON "DataPoint"("locationId", "metric");

-- CreateIndex
CREATE INDEX "ValidationFlag_locationId_idx" ON "ValidationFlag"("locationId");

-- AddForeignKey
ALTER TABLE "DataPoint" ADD CONSTRAINT "DataPoint_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationFlag" ADD CONSTRAINT "ValidationFlag_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

