-- The second GA4 identifier. `ga4PropertyId` (numeric) reads reports through
-- the Data API; this one is the "G-XXXXXXXXXX" measurement ID the site sends
-- events with. Neither can be derived from the other.
--
-- Nullable, and deliberately so: a site can be connected for Search Console
-- and WordPress reporting long before anyone sets up analytics. A NOT NULL
-- column would need a default, and the only available default is a wrong
-- measurement ID — which collects nothing while every page still renders.
ALTER TABLE "Website" ADD COLUMN "ga4MeasurementId" TEXT;
