-- QC checklist as editable data. Global: the checklist is what Control Panel
-- requires of every pub site, and a per-site copy would let a site opt out of
-- the rule it keeps failing.
CREATE TABLE "QcRule" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "params" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QcRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QcRule_checkId_key" ON "QcRule"("checkId");
CREATE INDEX "QcRule_kind_isActive_idx" ON "QcRule"("kind", "isActive");
