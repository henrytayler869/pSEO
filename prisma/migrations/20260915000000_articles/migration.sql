-- Editorial articles, their QC loop, and the cost of each one.

-- AiSpend.zip becomes nullable: an editorial article spans many ZIPs so there
-- is no single one to charge it to. The row is still written, because
-- getTotalSpendUsd() sums this table unfiltered and anything skipping it would
-- spend outside the hard cap.
ALTER TABLE "AiSpend" ALTER COLUMN "zip" DROP NOT NULL;
ALTER TABLE "AiSpend" ADD COLUMN "websiteId" TEXT;
ALTER TABLE "AiSpend" ADD COLUMN "articleId" TEXT;

CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qcReport" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "wpPostId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- One article per candidate per site. Re-running discovery must not offer an
-- angle that has already been written; the constraint enforces that rather
-- than trusting every call site to check first.
CREATE UNIQUE INDEX "Article_websiteId_candidateId_key" ON "Article"("websiteId", "candidateId");
CREATE INDEX "Article_websiteId_status_idx" ON "Article"("websiteId", "status");

ALTER TABLE "Article" ADD CONSTRAINT "Article_websiteId_fkey"
  FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ArticleJob" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "currentTitle" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ArticleJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ArticleJob_websiteId_status_idx" ON "ArticleJob"("websiteId", "status");

ALTER TABLE "ArticleJob" ADD CONSTRAINT "ArticleJob_websiteId_fkey"
  FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
