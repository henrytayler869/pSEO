-- Ghi lại URL đã gửi tới dịch vụ index bên thứ ba — và URL cố tình KHÔNG gửi.
-- Nhóm đối chứng là phần quan trọng nhất: một trang mới cuối cùng cũng được
-- index dù có gửi hay không, nên "gửi rồi thấy index" không chứng minh gì.
CREATE TABLE "IndexSubmission" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "campaignName" TEXT,
    "dripfeedDays" INTEGER,
    "indexedAtSubmit" BOOLEAN,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IndexSubmission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IndexSubmission_websiteId_url_provider_key" ON "IndexSubmission"("websiteId", "url", "provider");
CREATE INDEX "IndexSubmission_websiteId_arm_idx" ON "IndexSubmission"("websiteId", "arm");
ALTER TABLE "IndexSubmission" ADD CONSTRAINT "IndexSubmission_websiteId_fkey"
  FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
