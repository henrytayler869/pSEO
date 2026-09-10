-- WordPress Application Password, so the panel can write posts.
--
-- Both nullable: reading posts needs no credential (WP serves published
-- content unauthenticated), so a site without one degrades to a read-only
-- list rather than breaking. Making these NOT NULL would force a credential
-- onto every existing site before anyone had created one.
ALTER TABLE "Website" ADD COLUMN "wpUsername" TEXT;
ALTER TABLE "Website" ADD COLUMN "wpAppPassword" TEXT;
