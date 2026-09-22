-- `gscPropertyUrl` và `ga4PropertyId` trở thành tuỳ chọn: một site tồn tại
-- được trước khi có ai dựng property Search Console hoặc GA4. Với
-- gscPropertyUrl thì `@@unique` còn khiến NOT NULL chỉ cho phép ĐÚNG MỘT
-- site chưa có GSC.
--
-- Ở DB production đây là NO-OP: cả hai cột đã nullable từ trước (đo
-- 22/9/2026, information_schema trả is_nullable=YES) dù migration
-- 20260906000000_website khai TEXT NOT NULL. Migration này chép sự thật đó
-- vào repo thay vì để ba nguồn — DB, migrations, schema — nói hai câu.
ALTER TABLE "Website" ALTER COLUMN "gscPropertyUrl" DROP NOT NULL;
ALTER TABLE "Website" ALTER COLUMN "ga4PropertyId" DROP NOT NULL;
