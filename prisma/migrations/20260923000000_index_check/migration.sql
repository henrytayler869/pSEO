-- Log các lần đo trạng thái index. Thuần thêm bảng mới, không đụng dữ liệu cũ.
CREATE TABLE "IndexCheck" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "coverageState" TEXT NOT NULL,
    "lastCrawlAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IndexCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IndexCheck_submissionId_checkedAt_idx" ON "IndexCheck"("submissionId", "checkedAt");

ALTER TABLE "IndexCheck" ADD CONSTRAINT "IndexCheck_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "IndexSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
