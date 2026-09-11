-- Ý định tìm kiếm, ĐO từ DataForSEO chứ không khai báo trong code.
-- Cả hai cột cho phép null/rỗng: hàng lấy trước lần này chưa có dữ liệu, và
-- "chưa đo" phải phân biệt được với "không có ý định".
ALTER TABLE "SemanticKeyword" ADD COLUMN "mainIntent" TEXT;
ALTER TABLE "SemanticKeyword" ADD COLUMN "foreignIntent" TEXT[] DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "SemanticKeyword_vertical_mainIntent_idx" ON "SemanticKeyword"("vertical", "mainIntent");
