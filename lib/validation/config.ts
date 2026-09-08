import { prisma } from "@/lib/db/prisma";

export interface ValidationConfig {
  /** cross-check WARN threshold: % deviation between two sources for the same metric+location */
  crossCheckDeviationPct: number;
  /** outlier BLOCK threshold: value must be this many times the regional (state) mean to trip */
  outlierMultiplier: number;
  /** freshness WARN threshold, in days */
  freshnessMaxAgeDays: number;
  /** batch gate: BLOCK rate above this fraction blocks the whole snapshot */
  batchBlockRateThreshold: number;
}

const DEFAULTS: ValidationConfig = {
  crossCheckDeviationPct: 20,
  outlierMultiplier: 4,
  freshnessMaxAgeDays: 90,
  batchBlockRateThreshold: Number(process.env.VALIDATION_BLOCK_RATE_THRESHOLD ?? "0.05"),
};

/** Per-metric required-ness by source adapter. A location missing any
 * required metric for a source's snapshot fails the completeness check
 * (BLOCK). Optional metrics can be absent without penalty. */
/**
 * Metrics whose absence BLOCKS a location, set from measured coverage rather
 * than from reading adapter code.
 *
 * Measured 2026-09-08 against the latest OK snapshot of each source, over the
 * full registry of 300 Locations. The result separated into three groups with
 * a wide, unambiguous gap between them:
 *
 *   100.0%       8 metrics — Census ACS housing (4), Census mobility (4), FEMA
 *   98.0-98.7%   9 metrics — EIA, IRS (4), NREL (3), mobility_rate_pct
 *   60.0-90.7%   3 metrics — NOAA
 *
 * Nothing at all lands between 90.7% and 98.0%. That empty band is what makes
 * the line safe to draw: the boundary is not a threshold someone picked, it is
 * a place where the data has no members.
 *
 * The 98% group is required, not excused. Six missing locations out of 300 is
 * 2% — under the 5% batch gate, so flagging them costs nothing today, and if
 * that source degrades to 10% the gate fires, which is the entire point. A
 * location NREL rate-limited genuinely has no solar data; saying so is
 * accurate, not strict.
 *
 * NOAA stays out. At 60% coverage, requiring degree-days would block 40% of
 * locations, blow the 5% gate, mark the snapshot SUSPECT and discard 636 good
 * points — punishing a real gap by destroying the data around it.
 */
export const REQUIRED_METRICS_BY_ADAPTER: Record<string, string[]> = {
  nrel_pvwatts: ["solar_ac_annual_kwh", "solar_radiation_avg_kwh_per_m2_day", "solar_capacity_factor_pct"],
  census_acs_housing: [
    "census_median_home_value_usd",
    "census_median_household_income_usd",
    "census_homeownership_rate_pct",
    "census_median_year_built",
  ],
  census_mobility: [
    "census_moved_within_county",
    "census_moved_from_different_county",
    "census_moved_from_different_state",
    "census_moved_from_abroad",
  ],
  irs_migration: [
    "irs_migration_net_households",
    "irs_migration_inflow_households",
    "irs_migration_outflow_households",
    "irs_migration_inflow_agi_usd",
  ],
  eia_electricity: ["eia_residential_electricity_price_cents_per_kwh"],
  fema_disaster_declarations: ["fema_disaster_declarations_10yr"],
};

/**
 * Metrics a source normally returns, whose absence is worth SAYING rather
 * than blocking.
 *
 * Added because six of the seven adapters appeared in neither list, and
 * checkCompleteness returns immediately on an empty requirement list. So for
 * NOAA, Census, IRS, EIA and FEMA the completeness rule reported zero flags
 * every single run — and zero read exactly like "checked, nothing missing".
 * It meant "nothing was checked". The same disease as cross_source_deviation,
 * in the one rule specifically built to catch missing data.
 *
 * What it was missing is not hypothetical. NOAA v7 returned precipitation for
 * 272 locations but degree-days for only 184 and 180: roughly a third of
 * locations carry rainfall and no degree-days, because the adapter queries
 * each datatype independently and a county can have twelve months of one and
 * ten of another. Nothing surfaced that. It was found by a person reading
 * three row counts side by side and noticing they disagreed.
 *
 * WARN, not BLOCK, and the distinction is the whole point. These locations
 * are not broken — a market page with rainfall and no degree-days is a page
 * with one fewer fact, not a wrong page. Blocking them would mark the NOAA
 * snapshot SUSPECT over its own 5% batch gate and discard 636 good points to
 * punish a gap that costs one sentence of copy.
 *
 * WHY EVERYTHING STARTS HERE RATHER THAN IN THE REQUIRED LIST: promoting a
 * metric to BLOCK is a claim about how reliably the source publishes it, and
 * that claim needs measurement — per-metric coverage against the production
 * database — not a guess from reading adapter code. Census suppresses values
 * for small ZCTAs by design; requiring a suppressed field would block
 * locations for behaving exactly as documented. Make the gap visible first,
 * measure, then promote what the numbers support.
 */
export const EXPECTED_METRICS_BY_ADAPTER: Record<string, string[]> = {
  // 90.7% / 61.3% / 60.0%. The gap is real and worth reporting, but it is a
  // property of NOAA's station network, not a defect in any one location: the
  // adapter queries each datatype separately, and a county can have twelve
  // months of rainfall normals and ten of degree-days.
  noaa_climate_normals: [
    "noaa_precipitation_annual",
    "noaa_heating_degree_days_annual",
    "noaa_cooling_degree_days_annual",
  ],
  // 98.7%, and sitting with the required group by the numbers — but kept here
  // on what the metric IS rather than on its percentage. It is a RATE, derived
  // by division, and undefined where the denominator is zero. Requiring it
  // would block a location for a value that is not missing but mathematically
  // has no answer. Its four numerator siblings are at 100% and are required;
  // if they are present and this is not, the cause is arithmetic, not a
  // collection failure.
  census_mobility: ["census_mobility_rate_pct"],
  // Every other adapter's metrics are REQUIRED above. Listing them here too
  // would flag one gap at two severities.
};

/**
 * Every rule this system can emit.
 *
 * Exists so a report can show a rule that found nothing, which is not the same
 * as a rule that never ran. Reports built by counting the flags that exist can
 * only ever list rules that fired — a rule silently disabled by configuration
 * is invisible in exactly the output meant to prove the data was checked.
 *
 * Concretely: a run was reported as "missing_required_metric 0,
 * outlier_vs_regional_mean 0, schema_drift 0" and read as three clean checks.
 * Two of the three were clean. The first had no metrics registered and
 * inspected nothing, and impossible_value did not appear at all — not because
 * it passed, but because a DISTINCT over the flag table cannot name a rule
 * that has never written a row.
 */
export const ALL_VALIDATION_RULES = [
  "missing_required_metric",
  "missing_expected_metric",
  "impossible_value",
  "outlier_vs_regional_mean",
  "stale_data",
  "cross_source_deviation",
  "schema_drift",
] as const;

export async function getValidationConfig(): Promise<ValidationConfig> {
  const config = await prisma.appConfig.findUnique({ where: { key: "validation" } });
  if (config && typeof config.value === "object" && config.value !== null) {
    return { ...DEFAULTS, ...(config.value as Partial<ValidationConfig>) };
  }
  return DEFAULTS;
}
