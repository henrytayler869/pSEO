-- CreateEnum
CREATE TYPE "ScoreMode" AS ENUM ('PAYOUT', 'TRAFFIC');

-- AlterTable
ALTER TABLE "MarketIdentity" ALTER COLUMN "city" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MarketScore" ADD COLUMN     "cpcInput" DOUBLE PRECISION,
ADD COLUMN     "mode" "ScoreMode" NOT NULL DEFAULT 'PAYOUT',
ALTER COLUMN "payoutFloorInput" DROP NOT NULL,
ALTER COLUMN "estConversionRateInput" DROP NOT NULL;

-- Existing rows are all real coverage-import-based scores from before
-- TRAFFIC mode existed; the default above already backfills them correctly.
ALTER TABLE "MarketScore" ALTER COLUMN "mode" DROP DEFAULT;
