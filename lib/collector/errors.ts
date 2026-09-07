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

/**
 * An adapter cannot start because its credential was never configured.
 *
 * Deliberately distinct from a failure. A source that has never been turned on
 * is not a source that broke, and conflating the two makes a scheduled run
 * report red forever — for NOAA and EIA, every Monday, until somebody signs up
 * for a free API key they may never want.
 *
 * That matters more than tidiness. A red light that never changes is a red
 * light people stop reading, and the next genuine failure hides inside it. The
 * scheduled runner therefore treats this as SKIPPED rather than FAILED, but
 * only for a source that has never produced a good snapshot: if a source used
 * to work and its credential has since vanished, that IS a regression and
 * still fails the run.
 */
export class MissingCredentialError extends Error {
  constructor(
    message: string,
    /** The credential that is absent, so the runner can name it without
     * parsing the message. */
    public readonly credentialName: string
  ) {
    super(message);
    this.name = "MissingCredentialError";
  }
}
