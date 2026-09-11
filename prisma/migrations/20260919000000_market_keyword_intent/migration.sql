-- Ý định tìm kiếm đo cho TỪNG thị trường, không phải một nhãn cho cả ngành.
-- Cột nullable: hàng đã có chưa đo, và "chưa đo" phải khác "không có ý định".
ALTER TABLE "KeywordMetric" ADD COLUMN "mainIntent" TEXT;
CREATE INDEX "KeywordMetric_mainIntent_idx" ON "KeywordMetric"("mainIntent");
