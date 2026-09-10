-- Which trade a publisher site belongs to.
--
-- Three statements, not one, and the order matters. Adding a NOT NULL column
-- directly fails on any existing row; adding it nullable and leaving it that
-- way lets a site exist with no trade, which is the state this column was
-- added to make impossible.
--
-- So: add nullable, backfill, then tighten. A row the backfill cannot resolve
-- stays NULL and the SET NOT NULL fails, stopping the migration — loudly,
-- before the column can start lying.
ALTER TABLE "Website" ADD COLUMN "vertical" TEXT;

-- Backfill by matching the site's host against trades that actually have
-- markets, and ONLY when exactly one trade matches.
--
-- The uniqueness condition is the whole point. Matching on a host substring is
-- a guess, and a guess that lands on the wrong trade is worse than no guess at
-- all: every content rule would then check the wrong vocabulary and report
-- clean. Requiring a single match means this can fail, but cannot be wrong.
UPDATE "Website" w
SET "vertical" = m.only_match
FROM (
  SELECT w2.id,
         MIN(mi."vertical") AS only_match,
         COUNT(DISTINCT mi."vertical") AS n
  FROM "Website" w2
  JOIN (SELECT DISTINCT "vertical" FROM "MarketIdentity") mi
    ON replace(replace(replace(lower(w2."url"), 'https://', ''), 'http://', ''), 'www.', '')
       LIKE '%' || replace(mi."vertical", '-', '') || '%'
  GROUP BY w2.id
) m
WHERE w.id = m.id AND m.n = 1 AND w."vertical" IS NULL;

-- Any row still NULL — host matched no trade, or matched more than one — stops
-- the migration here. Resolve it by hand and re-run; do not relax this.
ALTER TABLE "Website" ALTER COLUMN "vertical" SET NOT NULL;

CREATE INDEX "Website_vertical_idx" ON "Website"("vertical");
