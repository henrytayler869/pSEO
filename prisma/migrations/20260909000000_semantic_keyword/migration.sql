-- CreateTable
CREATE TABLE "SemanticKeyword" (
    "id" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "searchVolume" INTEGER NOT NULL,
    "keywordDifficulty" DOUBLE PRECISION NOT NULL,
    "cpc" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SemanticKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SemanticKeyword_vertical_idx" ON "SemanticKeyword"("vertical");

-- CreateIndex
CREATE INDEX "SemanticKeyword_keyword_idx" ON "SemanticKeyword"("keyword");
