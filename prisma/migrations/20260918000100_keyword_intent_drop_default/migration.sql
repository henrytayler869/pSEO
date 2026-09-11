-- Bỏ DEFAULT trên foreignIntent.
--
-- Migration trước đặt DEFAULT ARRAY[]::TEXT[], còn Prisma sinh cột String[]
-- KHÔNG có default — nên `migrate diff` giữa migrations và schema báo lệch, và
-- cổng CI chặn đúng chỗ đó.
--
-- Sửa bằng migration nối tiếp chứ không sửa file cũ: file cũ đã chạy trên
-- production, và sửa nó sẽ làm sai checksum ở mọi môi trường đã áp dụng.
ALTER TABLE "SemanticKeyword" ALTER COLUMN "foreignIntent" DROP DEFAULT;
