import { prisma } from "@/lib/db/prisma";
import { SchemaDriftError, LocationFetchError } from "./errors";
import { HostUnreachableError } from "@/lib/net/curl-fetch";
import { mapWithConcurrency, sleep } from "./concurrency";
import type { CollectorAdapter, LocationRef } from "./types";

export interface CollectionFailure {
  locationId: string;
  zip: string;
  message: string;
}

export interface CollectionRunResult {
  /** Set when the host could not be reached at all. Separate from
   * driftMessage so the two never share a status note — they are different
   * failures with different people to call. */
  unreachableMessage?: string | null;
  snapshotId: string;
  status: "OK" | "SUSPECT";
  version: number;
  pointCount: number;
  locationsSucceeded: number;
  locationsFailed: number;
  failures: CollectionFailure[];
  driftMessage: string | null;
}

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_MAX_RETRIES = 2;

async function fetchWithRetry(
  adapter: CollectorAdapter,
  location: LocationRef,
  maxRetries: number
): ReturnType<CollectorAdapter["fetchOne"]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await adapter.fetchOne(location);
    } catch (err) {
      if (err instanceof SchemaDriftError) throw err; // never retry — it'll just fail the same way
      lastErr = err;
      if (attempt < maxRetries) {
        await sleep(300 * 2 ** attempt); // 300ms, 600ms, ...
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Runs one adapter over a batch of locations, creating a new DataSnapshot
 * (never overwriting a prior one — version increments per DataSource).
 * Per-location failures are retried, then logged and skipped — they never
 * fail the whole run silently (Module 3's completeness check is what turns
 * "we have no data for this location" into a BLOCK). A SchemaDriftError from
 * any location halts the run immediately: the snapshot is marked SUSPECT
 * with the drift reason, and no more locations are attempted, because a
 * changed response shape means nothing else this source returns this run
 * can be trusted either.
 */
/** Fraction of locations that may fail before the whole snapshot is
 * untrustworthy. Well below "most of them": a source that could not answer for
 * half the country did not have a bad day, it had a different failure. */
const MASS_FAILURE_THRESHOLD = 0.5;

/**
 * Whether a finished collection may be trusted as the source's current truth.
 *
 * Extracted and made pure so it can be TESTED. It used to be one inline
 * expression — `driftMessage !== null ? "SUSPECT" : "OK"` — which meant a run
 * where every single location failed was still recorded OK, and that is not a
 * hypothetical: on 2026-09-07 the Census API returned a well-formed response
 * carrying no usable values, all 300 locations threw, and the snapshot was
 * written OK with ZERO data points.
 *
 * The damage came from what OK means downstream. Queries read the latest OK
 * snapshot per source, so an empty OK snapshot SUPERSEDED a good one holding
 * 1,496 points: five metrics vanished from every market, all 148 fact
 * fingerprints changed, and 127 pages of already-generated copy became cache
 * misses in one step. Nothing failed. The run reported "cổng ĐẠT".
 *
 * Schema drift was the only failure this ever modelled — the case where the
 * response shape changes. It did not model the response staying the right
 * shape while carrying nothing, which is the more common way a public API
 * degrades under load.
 */
export function snapshotStatusFor(input: {
  driftMessage: string | null;
  /** Host unreachable — optional so existing callers/tests keep compiling,
   * but when present it decides the status on its own: not one byte was
   * received, so nothing collected this run can be the source's new truth. */
  unreachableMessage?: string | null;
  pointCount: number;
  locationsAttempted: number;
  locationsFailed: number;
}): "OK" | "SUSPECT" {
  if (input.driftMessage !== null) return "SUSPECT";
  if (input.unreachableMessage) return "SUSPECT";
  // Collected nothing at all. Whatever happened, this cannot be the new truth
  // for a source that previously had data.
  if (input.locationsAttempted > 0 && input.pointCount === 0) return "SUSPECT";
  if (input.locationsAttempted > 0 && input.locationsFailed / input.locationsAttempted > MASS_FAILURE_THRESHOLD) {
    return "SUSPECT";
  }
  return "OK";
}

export async function runCollection(params: {
  adapterKey: string;
  adapter: CollectorAdapter;
  locations: LocationRef[];
  concurrency?: number;
  maxRetries?: number;
}): Promise<CollectionRunResult> {
  const { adapterKey, adapter, locations, concurrency = DEFAULT_CONCURRENCY, maxRetries = DEFAULT_MAX_RETRIES } = params;

  const source = await prisma.dataSource.findUnique({ where: { adapterKey } });
  if (!source) {
    throw new Error(`Chưa có DataSource nào được đăng ký cho adapterKey "${adapterKey}" — hãy seed registry trước khi thu thập.`);
  }

  const lastVersion = await prisma.dataSnapshot.findFirst({
    where: { sourceId: source.id },
    orderBy: { version: "desc" },
  });
  const version = (lastVersion?.version ?? 0) + 1;

  const failures: CollectionFailure[] = [];
  let driftMessage: string | null = null;
  /**
   * Halts the run the way schema drift does, and for the same reason: the
   * failure is a property of the SOURCE, not of one location. If the host does
   * not resolve, it will not resolve for the other 287 zips either — pushing
   * on buys nothing and costs 287 × (1 + maxRetries) doomed attempts.
   *
   * Set only after a location has exhausted its retries, so a momentary
   * resolver hiccup still recovers instead of cancelling a good run.
   */
  let unreachableMessage: string | null = null;
  const collectedPoints: { locationId: string; metric: string; value: number; unit: string; resolvedAtResolution: string; isInferred: boolean; confidence: number }[] = [];

  await mapWithConcurrency(
    locations,
    concurrency,
    async (location) => {
      try {
        const points = await fetchWithRetry(adapter, location, maxRetries);
        for (const p of points) {
          collectedPoints.push({ locationId: location.locationId, ...p });
        }
      } catch (err) {
        if (err instanceof SchemaDriftError) {
          // Don't rethrow — that would escape mapWithConcurrency's
          // Promise.all and crash the whole run. Setting driftMessage is
          // enough: shouldAbort() stops every worker from picking up new
          // locations on its next loop iteration.
          driftMessage = err.message;
          return;
        }
        if (err instanceof HostUnreachableError) {
          unreachableMessage = err.message;
          console.error(`[collector:${adapterKey}] DỪNG — ${err.message}`);
          return;
        }
        const message = err instanceof LocationFetchError || err instanceof Error ? err.message : String(err);
        failures.push({ locationId: location.locationId, zip: location.zip, message });
        console.error(`[collector:${adapterKey}] failed for zip ${location.zip} (${location.locationId}): ${message}`);
      }
    },
    () => driftMessage !== null || unreachableMessage !== null
  );

  const status = snapshotStatusFor({
    driftMessage,
    unreachableMessage,
    pointCount: collectedPoints.length,
    locationsAttempted: locations.length,
    locationsFailed: failures.length,
  });
  const statusNoteParts: string[] = [];
  if (driftMessage) statusNoteParts.push(`Schema drift: ${driftMessage}`);
  // Its own label, never folded into the failure count. "288 địa điểm hỏng"
  // describes 288 separate problems and invites 288 separate theories; the
  // truth was one dead domain.
  if (unreachableMessage) statusNoteParts.push(`KHÔNG TỚI ĐƯỢC NGUỒN: ${unreachableMessage}`);
  if (failures.length > 0) {
    const shown = failures.slice(0, 20).map((f) => `${f.zip} (${f.message})`);
    const suffix = failures.length > 20 ? ` +${failures.length - 20} more` : "";
    statusNoteParts.push(`${failures.length} location(s) failed: ${shown.join("; ")}${suffix}`);
  }

  const snapshot = await prisma.dataSnapshot.create({
    data: {
      sourceId: source.id,
      version,
      status,
      statusNote: statusNoteParts.length > 0 ? statusNoteParts.join(" | ") : null,
    },
  });

  if (collectedPoints.length > 0) {
    await prisma.dataPoint.createMany({
      data: collectedPoints.map((p) => ({
        locationId: p.locationId,
        snapshotId: snapshot.id,
        metric: p.metric,
        value: p.value,
        unit: p.unit,
        resolvedAtResolution: p.resolvedAtResolution as never,
        isInferred: p.isInferred,
        confidence: p.confidence,
      })),
    });
  }

  const succeededLocationIds = new Set(collectedPoints.map((p) => p.locationId));

  return {
    snapshotId: snapshot.id,
    status,
    version,
    pointCount: collectedPoints.length,
    locationsSucceeded: succeededLocationIds.size,
    locationsFailed: failures.length,
    failures,
    driftMessage,
    unreachableMessage,
  };
}
