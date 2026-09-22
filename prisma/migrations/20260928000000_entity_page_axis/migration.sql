-- CreateTable
CREATE TABLE "EntityIdentity" (
    "id" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "axis" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "parentKey" TEXT,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEntityGeneration" (
    "id" TEXT NOT NULL,
    "entityIdentityId" TEXT NOT NULL,
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

    CONSTRAINT "AiEntityGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityIdentity_vertical_axis_idx" ON "EntityIdentity"("vertical", "axis");

-- CreateIndex
CREATE INDEX "EntityIdentity_vertical_parentKey_idx" ON "EntityIdentity"("vertical", "parentKey");

-- CreateIndex
CREATE UNIQUE INDEX "EntityIdentity_vertical_axis_key_key" ON "EntityIdentity"("vertical", "axis", "key");

-- CreateIndex
CREATE INDEX "AiEntityGeneration_entityIdentityId_idx" ON "AiEntityGeneration"("entityIdentityId");

-- CreateIndex
CREATE INDEX "AiEntityGeneration_factsFingerprint_idx" ON "AiEntityGeneration"("factsFingerprint");

-- AddForeignKey
ALTER TABLE "AiEntityGeneration" ADD CONSTRAINT "AiEntityGeneration_entityIdentityId_fkey" FOREIGN KEY ("entityIdentityId") REFERENCES "EntityIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
