-- Shared secret for calling a site's own /api/revalidate endpoint.
--
-- Without it, a setting changed here reaches the site only when its cache
-- happens to expire — and the site's HTML sits on Cloudflare for 24 hours. The
-- person who just typed a measurement ID would open the site, see no tag, and
-- reasonably conclude the feature does not work.
--
-- Nullable: a site that has not been given a secret still works, it just
-- updates on the slower path, and saying so is better than refusing to save.
ALTER TABLE "Website" ADD COLUMN "revalidateSecret" TEXT;
