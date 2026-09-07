"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { resolveAdapter } from "@/lib/collector/registry";
import { runCollection } from "@/lib/collector/run";
import { validateSnapshot } from "@/lib/validation/run";
import { compareToPreviousSnapshot, formatPercentChange } from "@/lib/collector/compare";

export interface ActionResult {
  ok: boolean;
  message: string;
  snapshotId?: string;
}

// NOAA CDO API enforces a hard 5 req/sec cap — the default concurrency (5)
// plus retry bursts can exceed that, so this source alone runs throttled.
const CONCURRENCY_OVERRIDES: Record<string, number> = { noaa_climate_normals: 4 };

async function runCollectionForSource(adapterKey: string): Promise<ActionResult> {
  try {
    const locations = await prisma.location.findMany();
    if (locations.length === 0) {
      return { ok: false, message: "Chưa có địa điểm nào được đăng ký — hãy seed bảng Location trước." };
    }

    const adapter = await resolveAdapter(adapterKey);
    const refs = locations.map((l) => ({ locationId: l.id, zip: l.zip, city: l.city, state: l.state, lat: l.lat, lon: l.lon, countyFips: l.countyFips }));

    const concurrency = CONCURRENCY_OVERRIDES[adapterKey];
    const result = await runCollection({ adapterKey, adapter, locations: refs, ...(concurrency ? { concurrency } : {}) });
    const validation = await validateSnapshot(result.snapshotId);
    const comparison = await compareToPreviousSnapshot(result.snapshotId);

    revalidatePath("/collector");
    revalidatePath(`/collector/${result.snapshotId}`);

    let message =
      `Snapshot v${result.version} (${result.status}): ${result.pointCount} điểm dữ liệu, ` +
      `${result.locationsFailed} địa điểm lấy dữ liệu thất bại. Xác thực: ${validation.blockedLocations}/${validation.totalLocations} ` +
      `bị chặn (${(validation.blockRate * 100).toFixed(1)}%) — cổng ${validation.batchGatePassed ? "ĐẠT" : "KHÔNG ĐẠT"}.`;

    if (comparison) {
      const deltaSummary = comparison.metrics
        .map((m) => `${m.metric}: ${formatPercentChange(m.percentChange)} (${m.significantChangeCount} zip đổi >10%)`)
        .join(", ");
      message += ` So với v${comparison.previousVersion}: ${deltaSummary || "không có chỉ số chung để so sánh"}.`;
    } else {
      message += " Đây là snapshot đầu tiên của nguồn này — chưa có dữ liệu cũ để so sánh.";
    }

    return { ok: true, snapshotId: result.snapshotId, message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Thu thập dữ liệu thất bại." };
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this exact (prevState, formData) signature; this action takes no input.
export async function runPvWattsCollectionAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  return runCollectionForSource("nrel_pvwatts");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this exact (prevState, formData) signature; this action takes no input.
export async function runCensusAcsHousingCollectionAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  return runCollectionForSource("census_acs_housing");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this exact (prevState, formData) signature; this action takes no input.
export async function runCensusMobilityCollectionAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  return runCollectionForSource("census_mobility");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this exact (prevState, formData) signature; this action takes no input.
export async function runIrsMigrationCollectionAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  return runCollectionForSource("irs_migration");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this exact (prevState, formData) signature; this action takes no input.
export async function runNoaaClimateNormalsCollectionAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  return runCollectionForSource("noaa_climate_normals");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this exact (prevState, formData) signature; this action takes no input.
export async function runEiaElectricityCollectionAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  return runCollectionForSource("eia_electricity");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this exact (prevState, formData) signature; this action takes no input.
export async function runFemaDisasterDeclarationsCollectionAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  return runCollectionForSource("fema_disaster_declarations");
}
