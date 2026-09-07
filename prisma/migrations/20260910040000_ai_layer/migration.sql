-- CreateTable
CREATE TABLE "AiGeneration" (
    "id" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "factsFingerprint" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "validationPassed" BOOLEAN NOT NULL,
    "validationNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSpend" (
    "id" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiGeneration_vertical_zip_idx" ON "AiGeneration"("vertical", "zip");

-- CreateIndex
CREATE INDEX "AiGeneration_factsFingerprint_idx" ON "AiGeneration"("factsFingerprint");

-- CreateIndex
CREATE INDEX "AiSpend_createdAt_idx" ON "AiSpend"("createdAt");

