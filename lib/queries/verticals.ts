import { prisma } from "@/lib/db/prisma";

/**
 * The trades that actually have markets, read from the data.
 *
 * One function, used by BOTH the connect form (to offer choices) and the
 * server action (to reject anything else). Two lists would drift, and the
 * drift would show up as a form offering a trade the action refuses — which
 * reads to the person filling it in as the form being broken.
 *
 * Read rather than declared, same reason `metricResolutions` is read: a
 * hard-coded list here would be a second definition of what a trade is, and
 * the coverage data is the first one.
 *
 * Sorted so the form's order does not change between renders for no reason.
 */
export async function getVerticalsWithMarkets(): Promise<string[]> {
  const rows = await prisma.marketIdentity.findMany({
    select: { vertical: true },
    distinct: ["vertical"],
  });
  return rows.map((r) => r.vertical).sort((a, b) => a.localeCompare(b));
}
