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

/**
 * Turns a non-200 HTTP status into the RIGHT kind of error.
 *
 * Five adapters independently wrote `if (status !== 200) throw new
 * SchemaDriftError(...)`, which says a transport failure is a change in the
 * response shape. It is not, and the mislabelling costs real time: FEMA
 * returned 403 with an HTML body and the run announced schema drift, sending
 * whoever read it looking for a field that had changed. NOAA had the same
 * confusion in a different form. Both were found by someone reading a message
 * that confidently named the wrong cause.
 *
 * SchemaDriftError means "this source is still answering, but I no longer
 * understand what it says" — and it stops the whole run, because nothing else
 * from that source can be trusted either. A 403, 429 or 500 means the source
 * did not answer at all, which is a different situation with a different fix
 * and, usually, a different person to call.
 *
 * The distinction survives downstream: a run where every location hits 429 ends
 * up SUSPECT through the majority-failed rule, with "N/M locations failed"
 * reported instead of a schema change that never happened.
 */
export function assertHttpOk(
  status: number,
  body: Buffer | string,
  context: string,
  opts?: {
    /** True when this endpoint takes NO credential at all.
     *
     * It changes what a 403 means, and therefore who should be called. On an
     * authenticated API a 403 points at the key. On a public one there is no
     * key to be wrong, so it points at the network path — a WAF, an IP
     * reputation rule, a geo block.
     *
     * Not hypothetical: FEMA is public and returned 403 with an Akamai block
     * page for every request from the server, while the identical URL answered
     * 200 from a residential connection. The generic message would have sent
     * someone looking for a credential that does not exist. */
    unauthenticated?: boolean;
  }
): void {
  if (status === 200) return;

  const snippet = (typeof body === "string" ? body : body.toString("utf-8")).slice(0, 200).replace(/\s+/g, " ").trim();

  // Named explicitly because it is transient and self-healing, and because the
  // fix is "wait" rather than anything in this repository — a distinction worth
  // handing the reader rather than making them infer it from a number.
  if (status === 429) {
    throw new LocationFetchError(`${context}: HTTP 429 — bị giới hạn tần suất, thử lại sau. ${snippet}`);
  }
  if (status === 401 || status === 403) {
    const cause = opts?.unauthenticated
      ? "API này KHÔNG dùng khoá, nên đây KHÔNG phải vấn đề credential — nhiều khả năng bị chặn theo IP/WAF. " +
        "Kiểm bằng cách gọi cùng URL từ một mạng khác trước khi sửa bất cứ thứ gì trong repo."
      : "khoá sai, hết hạn, hoặc thiếu quyền";
    throw new LocationFetchError(`${context}: HTTP ${status} — bị từ chối. ${cause} KHÔNG phải lệch schema. ${snippet}`);
  }
  throw new LocationFetchError(`${context}: HTTP ${status}. ${snippet}`);
}
