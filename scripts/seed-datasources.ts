// Seeds the DataSource registry with sources that actually have a working
// adapter (lib/collector/registry.ts). Previously listed 4 more sources
// (EIA, BLS OEWS, Census home-age/permits, NOAA Climate Normals) as
// "planned" placeholders with isActive:false and no real adapter behind
// them — removed on request: a catalog row that can never successfully
// collect anything reads as demo/aspirational clutter, not real
// infrastructure. NOAA and EIA below now have real adapters (added
// 2026-09-06) built from each provider's own documentation but not yet
// verified against a live call — see the adapter docstrings for exactly
// what's confirmed vs. assumed. BLS OEWS remains a documented-but-deferred
// candidate: its series-ID construction needs a separate BLS area-code
// lookup table this app doesn't have yet. See "Data sources — shipped and
// candidates" in README for details (NOAA, EIA, BLS, FEMA).

import { prisma } from "../lib/db/prisma";

const SOURCES = [
  {
    name: "NREL PVWatts",
    adapterKey: "nrel_pvwatts",
    endpoint: "https://developer.nlr.gov/api/pvwatts/v8.json", // developer.nrel.gov retired 2026-05-29 — NREL renamed to NLR
    unit: "kWh/yr (ac_annual), kWh/m2/day (solrad_annual), % (capacity_factor)",
    geoResolution: "ZIP" as const,
    refreshInterval: "P180D", // solar resource data barely changes; refresh twice a year
    isActive: true,
    relevantVerticals: ["solar-installation"],
  },
  {
    name: "Census ACS5 (housing & income)",
    adapterKey: "census_acs_housing",
    endpoint: "https://api.census.gov/data/2023/acs/acs5",
    unit: "USD (median home value, median household income), year (median year built), % (homeownership rate)",
    geoResolution: "ZIP" as const,
    refreshInterval: "P365D", // ACS5 is an annual release
    isActive: true,
    // Older housing stock + higher home value both drive real quote
    // variance for the first three — not solar, which already has PVWatts
    // as its dedicated, more directly relevant source. moving-services
    // added 2026-09-06: household income/home value both shape real
    // moving decisions and cost, alongside irs_migration's actual flow data.
    relevantVerticals: ["roofing-replacement", "hvac-repair", "water-damage-restoration", "moving-services"],
  },
  {
    name: "Census ACS5 (geographic mobility)",
    adapterKey: "census_mobility",
    endpoint: "https://api.census.gov/data/2023/acs/acs5 (table B07003)",
    unit: "people/yr (moved within county, from another county, from another state, from abroad), % (mobility rate)",
    geoResolution: "ZIP" as const,
    refreshInterval: "P365D", // ACS5 is an annual release
    isActive: true,
    // The only source here that measures the act of moving at ZIP
    // resolution — irs_migration covers real household flows but only per
    // county, so every zip in a county gets the same inferred number.
    relevantVerticals: ["moving-services"],
  },
  {
    name: "IRS SOI County Migration",
    adapterKey: "irs_migration",
    endpoint: "https://www.irs.gov/pub/irs-soi/countyinflow2223.csv",
    unit: "households/yr (inflow, outflow, net), USD/yr (inflow AGI)",
    geoResolution: "COUNTY" as const, // reported per county, attributed to every zip within it (isInferred:true on the DataPoint)
    refreshInterval: "P365D", // annual static file release, no live query API
    isActive: true,
    relevantVerticals: ["moving-services"],
  },
  {
    name: "NOAA Climate Normals (1991-2020 monthly)",
    adapterKey: "noaa_climate_normals",
    endpoint: "https://www.ncei.noaa.gov/cdo-web/api/v2/data?datasetid=NORMAL_MLY",
    unit: "degree-days/yr (heating, cooling), in/yr (precipitation)",
    geoResolution: "ZIP" as const,
    refreshInterval: "P365D", // climate normals are a static 30-year reference period, refresh is just a freshness check
    isActive: true,
    // Heating/cooling degree days drive real HVAC sizing and runtime;
    // precipitation drives real roof wear and water-intrusion risk.
    relevantVerticals: ["hvac-repair", "roofing-replacement", "water-damage-restoration"],
  },
  {
    name: "EIA Residential Electricity Prices",
    adapterKey: "eia_electricity",
    endpoint: "https://api.eia.gov/v2/electricity/retail-sales/data",
    unit: "cents/kWh (residential retail price)",
    geoResolution: "STATE" as const,
    refreshInterval: "P365D", // EIA publishes this as an annual series
    isActive: true,
    // Converts PVWatts' kWh production estimate into real dollar savings —
    // the number a solar lead actually cares about.
    relevantVerticals: ["solar-installation"],
  },
  {
    name: "FEMA OpenFEMA Disaster Declarations",
    adapterKey: "fema_disaster_declarations",
    endpoint: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries",
    unit: "count/10yr (property-damage-relevant federal disaster declarations)",
    geoResolution: "COUNTY" as const, // reported per county, attributed to every zip within it (isInferred:true on the DataPoint)
    refreshInterval: "P90D", // new declarations happen year-round, unlike the other annual-release sources
    isActive: true,
    // Real, sourced evidence for urgency framing ("N declared disasters in
    // this county since 2016") instead of generic scare-copy.
    relevantVerticals: ["roofing-replacement", "water-damage-restoration"],
  },
];

async function main() {
  // Drop any previously-seeded placeholder sources that are no longer part
  // of the roster, so a re-run of this script actually reflects "only real
  // adapters" rather than just adding to whatever was seeded before.
  const currentKeys = SOURCES.map((s) => s.adapterKey);
  const removed = await prisma.dataSource.deleteMany({ where: { adapterKey: { notIn: currentKeys } } });
  if (removed.count > 0) {
    console.log(`Removed ${removed.count} non-working placeholder DataSource row(s).`);
  }

  for (const source of SOURCES) {
    await prisma.dataSource.upsert({
      where: { adapterKey: source.adapterKey },
      create: source,
      update: source,
    });
  }
  console.log(`Seeded ${SOURCES.length} DataSource row(s), all with real working adapters.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
