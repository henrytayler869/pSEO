import { prisma } from "@/lib/db/prisma";

export interface DefineNicheResult {
  vertical: string;
  locationCount: number;
  created: number;
  alreadyExisted: number;
}

/** Creates a MarketIdentity(zip, vertical) for every real Location currently
 * registered — no CoverageImport/network relationship required. This is the
 * TRAFFIC-mode entry point to Module 1: define a niche to research purely by
 * geography (real Census-sourced zips), then layer in keyword data
 * (fetchKeywordMetricsForVertical) and a traffic-only score
 * (computeTrafficScoresForVertical). Skips zips that already have this
 * vertical — from a prior run of the same niche, or from a real coverage
 * import that happens to cover the same zip/vertical pair. */
export async function defineNicheAcrossLocations(vertical: string): Promise<DefineNicheResult> {
  const locations = await prisma.location.findMany();
  if (locations.length === 0) {
    throw new Error(
      "Chưa có Location nào trong hệ thống. Chạy scripts/generate-locations-from-census.ts rồi scripts/seed-collector-demo.ts trước."
    );
  }

  const result = await prisma.marketIdentity.createMany({
    data: locations.map((loc) => ({
      zip: loc.zip,
      vertical,
      city: loc.city,
      state: loc.state,
    })),
    skipDuplicates: true,
  });

  return {
    vertical,
    locationCount: locations.length,
    created: result.count,
    alreadyExisted: locations.length - result.count,
  };
}

/** Lowercase, hyphenated — so a niche typed as "Tax Relief" becomes
 * "tax-relief", matching the existing vertical naming convention
 * (roofing-replacement, hvac-repair). */
export function normalizeVertical(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
