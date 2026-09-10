-- Shared secret proving a WordPress write came from Head Quarter.
--
-- Nullable and NOT backfilled. A site without it keeps working for reads and
-- fails writes with 401 — the visible direction. Generating a value here would
-- create a secret that exists in the database and nowhere else, so the plugin
-- would compare against something it has never been told.
ALTER TABLE "Website" ADD COLUMN "wpLoopbackSecret" TEXT;
