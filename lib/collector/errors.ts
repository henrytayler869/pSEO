/**
 * Thrown by an adapter when the response shape doesn't match what it
 * expects — a field disappeared, changed type, or the envelope changed.
 * This is NOT a per-location failure (a bad zip, a rate limit): it means
 * the adapter can no longer trust anything this source is returning, so
 * the whole in-progress DataSnapshot gets marked SUSPECT and collection
 * stops, rather than writing partially-parsed garbage for every remaining
 * location.
 */
export class SchemaDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaDriftError";
  }
}

/** A single location's fetch failed after retries — transient (network,
 * rate limit, bad geocode for that one zip). Collection continues for the
 * rest of the batch; the Validator's completeness check is what surfaces
 * this location's missing data, not a thrown error here. */
export class LocationFetchError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "LocationFetchError";
  }
}
