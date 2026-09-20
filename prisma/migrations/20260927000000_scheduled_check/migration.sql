-- Kết quả từng lần chạy của phép kiểm định kỳ, kể cả lần sạch.
CREATE TABLE "ScheduledCheck" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "detail" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduledCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledCheck_websiteId_kind_checkedAt_idx" ON "ScheduledCheck"("websiteId", "kind", "checkedAt");

ALTER TABLE "ScheduledCheck" ADD CONSTRAINT "ScheduledCheck_websiteId_fkey"
    FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
