-- Đoạn diễn giải cấp CỤM. Bảng riêng, không nới AiGeneration thành nullable:
-- mỗi hàng ở bảng kia nói về đúng một ZIP, và hai thứ khác nhau cả về hình
-- dạng fact (dải vs giá trị đơn) lẫn bộ luật kiểm.
CREATE TABLE "AiClusterGeneration" (
    "id" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "memberZips" TEXT[],
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
    CONSTRAINT "AiClusterGeneration_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiClusterGeneration_vertical_clusterId_idx" ON "AiClusterGeneration"("vertical", "clusterId");
CREATE INDEX "AiClusterGeneration_factsFingerprint_idx" ON "AiClusterGeneration"("factsFingerprint");
