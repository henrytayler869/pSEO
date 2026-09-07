import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    } catch {
      throw nativeFetchError; // curl fallback also failed — surface the original, more informative error
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
