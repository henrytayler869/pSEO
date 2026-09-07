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
export const REQUIRED_METRICS_BY_ADAPTER: Record<string, string[]> = {
  nrel_pvwatts: ["solar_ac_annual_kwh", "solar_radiation_avg_kwh_per_m2_day", "solar_capacity_factor_pct"],
};

export async function getValidationConfig(): Promise<ValidationConfig> {
  const config = await prisma.appConfig.findUnique({ where: { key: "validation" } });
  if (config && typeof config.value === "object" && config.value !== null) {
    return { ...DEFAULTS, ...(config.value as Partial<ValidationConfig>) };
  }
  return DEFAULTS;
}
