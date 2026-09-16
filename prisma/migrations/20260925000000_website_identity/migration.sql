-- Danh tính hiển thị của site, chuyển từ hằng số trong mã nguồn publisher về
-- database, vì một app dùng chung phục vụ nhiều domain không thể mang hằng số.
--
-- Nullable: hàng đang có chưa có giá trị, và migration không được vỡ vì điều
-- đó. Chỗ chặn "site chưa đủ danh tính" nằm ở tầng API (ready/missing), không
-- nằm ở NOT NULL — một NOT NULL ở đây sẽ buộc bịa nội dung cho site đang chạy.
ALTER TABLE "Website" ADD COLUMN "tagline" TEXT;
ALTER TABLE "Website" ADD COLUMN "description" TEXT;
