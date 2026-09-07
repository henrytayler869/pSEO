-- AlterTable
ALTER TABLE "DataSource" ADD COLUMN     "relevantVerticals" TEXT[] DEFAULT ARRAY[]::TEXT[];
