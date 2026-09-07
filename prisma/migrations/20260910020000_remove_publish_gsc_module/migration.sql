-- Removes the Publish Queue + GSC Loop module (2026-09-06). Dropped on
-- request: with Page Builder already gone, nothing creates Page rows
-- anymore, and the real websites now own their own publishing + Search
-- Console reporting (tracked live per-site in /publisher instead).
-- The 5 Page rows dropped here were orphaned QUEUED leftovers from the
-- deleted Page Builder — never published, no batches/snapshots/
-- recommendations existed against them.

-- DropForeignKey
ALTER TABLE "GscSnapshot" DROP CONSTRAINT "GscSnapshot_pageId_fkey";

-- DropForeignKey
ALTER TABLE "Page" DROP CONSTRAINT "Page_dataSnapshotId_fkey";

-- DropForeignKey
ALTER TABLE "Page" DROP CONSTRAINT "Page_marketIdentityId_fkey";

-- DropForeignKey
ALTER TABLE "Page" DROP CONSTRAINT "Page_publishBatchId_fkey";

-- DropForeignKey
ALTER TABLE "Recommendation" DROP CONSTRAINT "Recommendation_pageId_fkey";

-- DropTable
DROP TABLE "GscSnapshot";

-- DropTable
DROP TABLE "Page";

-- DropTable
DROP TABLE "PublishBatch";

-- DropTable
DROP TABLE "Recommendation";

-- DropEnum
DROP TYPE "BatchGateStatus";

-- DropEnum
DROP TYPE "PageStatus";

-- DropEnum
DROP TYPE "RecommendationStatus";

-- DropEnum
DROP TYPE "RecommendationType";
