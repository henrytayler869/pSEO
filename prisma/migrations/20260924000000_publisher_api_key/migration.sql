-- Khoá API theo từng publisher. Thuần thêm bảng mới; không đụng bảng nào
-- đang có, không đụng dữ liệu nào đang có.
--
-- THỨ TỰ TRIỂN KHAI QUAN TRỌNG:
--   1. chạy migration này          (bảng rỗng, không ai đọc → vô hại)
--   2. chạy scripts/backfill-legacy-api-key.ts  (chuyển khoá dùng chung cũ vào đây)
--   3. mới deploy mã nguồn mới
-- Đảo 2 và 3 thì site đang chạy mất xác thực trong quãng giữa.
CREATE TABLE "PublisherApiKey" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublisherApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublisherApiKey_keyPrefix_key" ON "PublisherApiKey"("keyPrefix");
CREATE UNIQUE INDEX "PublisherApiKey_keyHash_key" ON "PublisherApiKey"("keyHash");
CREATE INDEX "PublisherApiKey_websiteId_idx" ON "PublisherApiKey"("websiteId");

ALTER TABLE "PublisherApiKey" ADD CONSTRAINT "PublisherApiKey_websiteId_fkey"
    FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
