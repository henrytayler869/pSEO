import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Both transports failed to REACH the host — no HTTP conversation happened.
 *
 * Distinct from an HTTP error because the fix and the culprit are different.
 * A 429 means the source answered and asked us to slow down; this means
 * nothing answered at all, and no amount of waiting on OUR side is
 * necessarily the remedy.
 *
 * It exists because the old code threw Node's raw fetch error, whose message
 * is the literal string "fetch failed" — the real cause (ENOTFOUND) sits in
 * `.cause`, which nothing logged. So a DNS zone vanishing and a connection
 * being refused and a TLS failure all reached the operator as three words
 * that name none of them.
 *
 * That is not theoretical. On 2026-09-08 the entire nrel.gov zone lost its
 * delegation in the .gov TLD — `dig SOA nrel.gov` answered NOERROR with the
 * `gov.` SOA in AUTHORITY, i.e. the parent saying "no such delegation" — while
 * fema.gov, census.gov, noaa.gov and eia.gov all resolved normally from the
 * same machine at the same second.
 *
 * CORRECTION, and it is the more useful half of the story: that dead zone was
 * never ours to worry about. The solar adapter had already moved to
 * developer.nlr.gov after the lab renamed, and nlr.gov resolves and answers
 * normally. Two people — one watching the server, one reading the code —
 * spent a round trip on a retired hostname because a collector that HAD been
 * returning HTTP 429 from the live host looked, at the log level, exactly like
 * a collector talking to a host that no longer exists.
 *
 * Which is the point. The two failures were a hair apart in meaning — "we hit
 * the quota" invites waiting, "the domain is gone" does not — and identical on
 * screen, because both arrived as the string "fetch failed". The fix below is
 * worth having on its own merits; the incident that prompted it turned out to
 * be a misreading that this exact fix is what prevents.
 */
export class HostUnreachableError extends Error {
  constructor(
    message: string,
    public readonly host: string,
    /** What actually went wrong, for code that must branch rather than read. */
    public readonly kind: "dns" | "connection" | "timeout" | "tls" | "unknown",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "HostUnreachableError";
  }
}

/** curl's own exit codes. Preferred over Node's error when both are present:
 * curl is the second, independent observation, and its codes are specific
 * where Node's message is not. */
const CURL_EXIT: Record<number, { kind: HostUnreachableError["kind"]; vi: string }> = {
  6: { kind: "dns", vi: "không phân giải được tên miền" },
  7: { kind: "connection", vi: "phân giải được tên miền nhưng không kết nối được" },
  28: { kind: "timeout", vi: "hết thời gian chờ" },
  35: { kind: "tls", vi: "bắt tay TLS thất bại" },
};

/** Node surfaces the real reason in a `.cause` chain, never in `.message`. */
function rootCauseCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

const NODE_CODE: Record<string, { kind: HostUnreachableError["kind"]; vi: string }> = {
  ENOTFOUND: { kind: "dns", vi: "tên miền không tồn tại trên DNS" },
  EAI_AGAIN: { kind: "dns", vi: "tra cứu DNS thất bại tạm thời" },
  ECONNREFUSED: { kind: "connection", vi: "kết nối bị từ chối" },
  ECONNRESET: { kind: "connection", vi: "kết nối bị ngắt giữa chừng" },
  ETIMEDOUT: { kind: "timeout", vi: "hết thời gian chờ" },
  UND_ERR_CONNECT_TIMEOUT: { kind: "timeout", vi: "hết thời gian chờ khi kết nối" },
};

/**
 * Names the failure both transports just hit, in the operator's language.
 *
 * Deliberately reports which evidence it used. When curl and Node disagree —
 * or when neither yields a recognised code — saying so is more useful than a
 * confident guess, because the next person's move depends on whether this is
 * "the domain is gone" or "I could not tell".
 */
export function describeTransportFailure(host: string, nativeErr: unknown, curlErr: unknown): HostUnreachableError {
  const curlStatus = (curlErr as { status?: unknown } | null)?.status;
  const curlHit = typeof curlStatus === "number" ? CURL_EXIT[curlStatus] : undefined;
  if (curlHit) {
    return new HostUnreachableError(
      `Không tới được ${host}: ${curlHit.vi} (curl exit ${curlStatus}). ` +
        `KHÔNG phải giới hạn tần suất và KHÔNG phải lệch schema — máy chủ chưa hề trả lời.` +
        (curlHit.kind === "dns"
          ? ` Kiểm tra bằng: dig SOA ${host} — nếu phần AUTHORITY trả về SOA của TLD thì zone đã mất uỷ quyền, không phải lỗi phía ta.`
          : ""),
      host,
      curlHit.kind,
      nativeErr
    );
  }

  const code = rootCauseCode(nativeErr);
  const nodeHit = code ? NODE_CODE[code] : undefined;
  if (nodeHit) {
    return new HostUnreachableError(
      `Không tới được ${host}: ${nodeHit.vi} (${code}). ` +
        `KHÔNG phải giới hạn tần suất và KHÔNG phải lệch schema — máy chủ chưa hề trả lời.`,
      host,
      nodeHit.kind,
      nativeErr
    );
  }

  const native = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
  return new HostUnreachableError(
    `Không tới được ${host}: cả fetch lẫn curl đều hỏng và KHÔNG nhận ra nguyên nhân. ` +
      `fetch nói "${native}"${code ? ` (code ${code})` : ""}` +
      `${typeof curlStatus === "number" ? `, curl exit ${curlStatus}` : ""}. ` +
      `Chưa phân loại được — đừng suy ra là giới hạn tần suất.`,
    host,
    "unknown",
    nativeErr
  );
}

export interface CurlFetchResult {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/**
 * Which transport actually served each request this process.
 *
 * Counted because a fallback that never reports itself hides the health of
 * the thing it is falling back FROM. Every tolerance mechanism creates a
 * blind spot the exact size of what it tolerates, and this one tolerates the
 * primary network path failing — so if `fetch` broke for every host tomorrow,
 * collection would keep succeeding through curl and nothing would say so. The
 * run would just get slower (curl spawns a process and carries `--retry 2`)
 * for no visible reason.
 *
 * It hides the good news too: if the underlying Node issue were fixed, no one
 * would find out, and a process-spawning fallback nobody can justify removing
 * stays forever.
 */
const transportStats = {
  native: 0,
  curl: 0,
  /** host -> the fetch error curl recovered from. Kept because the catch
   * below is not selective (see the note in the function) and this is the
   * only place a non-network error would become visible. */
  fallbackReasons: new Map<string, string>(),
};

export function getTransportStats(): { native: number; curl: number; fallbackReasons: Record<string, string> } {
  return {
    native: transportStats.native,
    curl: transportStats.curl,
    fallbackReasons: Object.fromEntries(transportStats.fallbackReasons),
  };
}

/**
 * Shared fallback for a real, reproducible issue in this environment:
 * Node's own `fetch` has repeatedly failed to connect to real, live hosts
 * (confirmed for api.census.gov and wordpress.org — ETIMEDOUT on IPv4, no
 * IPv6 route) while `curl` reaches the identical URL in under 1.5s every
 * time. Root cause unconfirmed (Node's networking stack vs. this specific
 * network path), but since this has now hit unrelated hosts more than
 * once, every new external adapter tries `fetch` first (fast, no process
 * spawn, portable) and falls back to `curl` when that throws.
 *
 * NOTE ON THE CATCH, corrected: an earlier version of this comment claimed
 * the fallback only triggers on "a network-level error". It does not — the
 * catch covers everything the try block can throw, including a failure while
 * reading the body. Nothing here distinguishes the two, so a non-network bug
 * would be quietly retried over curl and look like the known network issue.
 * Narrowing the catch would risk breaking collection that currently works, so
 * the error is RECORDED instead: `getTransportStats().fallbackReasons` is
 * where a wrong assumption about why the fallback fires becomes visible.
 */
export async function fetchWithCurlFallback(
  url: string,
  headers?: Record<string, string>
): Promise<CurlFetchResult> {
  try {
    const response = await fetch(url, headers ? { headers } : undefined);
    const body = Buffer.from(await response.arrayBuffer());
    transportStats.native++;
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
  } catch (nativeFetchError) {
    try {
      const result = await curlGet(url, headers);
      transportStats.curl++;
      const host = safeHost(url);
      if (!transportStats.fallbackReasons.has(host)) {
        const reason = nativeFetchError instanceof Error ? nativeFetchError.message : String(nativeFetchError);
        transportStats.fallbackReasons.set(host, reason);
        // Warned once per host, not per request: the point is to make the
        // primary path's failure visible, not to bury the run in noise.
        console.warn(`[net] fetch() hỏng với ${host}, đã dùng curl thay thế — ${reason}`);
      }
      return result;
    } catch (curlError) {
      // Both paths are down, so this is about reaching the host at all.
      //
      // This used to rethrow nativeFetchError, on the reasoning that the
      // original error was "more informative". It was not: Node's is the
      // string "fetch failed". Every distinct way a host can be unreachable
      // arrived at the operator wearing the same three words, and the one
      // time it mattered — a whole .gov zone losing its DNS delegation — the
      // symptom was indistinguishable at a glance from the rate limiting
      // that host had genuinely been doing for days.
      throw describeTransportFailure(safeHost(url), nativeFetchError, curlError);
    }
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 60);
  }
}

async function curlGet(url: string, headers?: Record<string, string>): Promise<CurlFetchResult> {
  const { execFileSync } = await import("node:child_process");
  const tmpPath = path.join(os.tmpdir(), `curl-fetch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const headerArgs = Object.entries(headers ?? {}).flatMap(([name, value]) => ["-H", `${name}: ${value}`]);
  try {
    const headerOutput = execFileSync(
      "curl",
      [
        "-s",
        "-D",
        "-",
        "-o",
        tmpPath,
        "-w",
        "\n__STATUS__%{http_code}",
        "--max-time",
        "30",
        "--retry",
        "2",
        ...headerArgs,
        url,
      ],
      { encoding: "utf-8" }
    );
    const statusMatch = headerOutput.match(/__STATUS__(\d+)/);
    if (!statusMatch) throw new Error("curl fallback: could not parse status code");
    const status = Number(statusMatch[1]);

    const headers: Record<string, string> = {};
    for (const line of headerOutput.split("\n")) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) continue;
      const name = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();
      if (name) headers[name] = value;
    }
    const body = fs.readFileSync(tmpPath);
    return { status, headers, body };
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}
