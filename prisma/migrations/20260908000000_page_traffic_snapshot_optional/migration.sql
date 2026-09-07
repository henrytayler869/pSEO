-- DropForeignKey
ALTER TABLE "Page" DROP CONSTRAINT "Page_dataSnapshotId_fkey";

-- AlterTable
ALTER TABLE "Page" ALTER COLUMN "dataSnapshotId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_dataSnapshotId_fkey" FOREIGN KEY ("dataSnapshotId") REFERENCES "DataSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
