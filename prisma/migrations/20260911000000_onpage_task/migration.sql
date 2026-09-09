-- The DataForSEO OnPage crawl belonging to a website.
--
-- Stored so the summary can be re-read without paying to crawl again. Reading
-- results is free; crawling is $0.00015 per page. Without this column the only
-- way back to a finished crawl would be to start a new one, which is the sort
-- of design that quietly turns a 3-cent feature into a recurring bill.
ALTER TABLE "Website" ADD COLUMN "onPageTaskId" TEXT;
ALTER TABLE "Website" ADD COLUMN "onPageTaskAt" TIMESTAMP(3);
ALTER TABLE "Website" ADD COLUMN "onPageMaxPages" INTEGER;
