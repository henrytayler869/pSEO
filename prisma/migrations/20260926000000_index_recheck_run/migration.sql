-- Pipeline đo lại index: một hàng cho MỖI lần chạy, kể cả lần bỏ qua.
CREATE TABLE "IndexRecheckRun" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "checked" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" TEXT,
    "error" TEXT,
    CONSTRAINT "IndexRecheckRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IndexRecheckRun_websiteId_startedAt_idx" ON "IndexRecheckRun"("websiteId", "startedAt");

ALTER TABLE "IndexRecheckRun" ADD CONSTRAINT "IndexRecheckRun_websiteId_fkey"
    FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
