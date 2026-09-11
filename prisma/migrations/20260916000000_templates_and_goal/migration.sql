-- Per-publisher article templates, and the goal that shapes recommendations.

ALTER TABLE "Website" ADD COLUMN "goal" TEXT;

CREATE TABLE "ArticleTemplate" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ArticleTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArticleTemplate_websiteId_intent_name_key" ON "ArticleTemplate"("websiteId", "intent", "name");
CREATE INDEX "ArticleTemplate_websiteId_isActive_idx" ON "ArticleTemplate"("websiteId", "isActive");

ALTER TABLE "ArticleTemplate" ADD CONSTRAINT "ArticleTemplate_websiteId_fkey"
  FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
