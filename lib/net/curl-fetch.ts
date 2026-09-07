import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CurlFetchResult {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/**
 * Shared fallback for a real, reproducible issue in this environment:
 * Node's own `fetch` has repeatedly failed to connect to real, live hosts
 * (confirmed for api.census.gov and wordpress.org — ETIMEDOUT on IPv4, no
 * IPv6 route) while `curl` reaches the identical URL in under 1.5s every
 * time. Root cause unconfirmed (Node's networking stack vs. this specific
 * network path), but since this has now hit unrelated hosts more than
 * once, every new external adapter tries `fetch` first (fast, no process
 * spawn, portable) and only shells out to `curl` if that throws a
 * network-level error — zero overhead wherever the underlying issue
 * doesn't exist, graceful recovery where it does.
 */
export async function fetchWithCurlFallback(
  url: string,
  headers?: Record<string, string>
): Promise<CurlFetchResult> {
  try {
    const response = await fetch(url, headers ? { headers } : undefined);
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
  } catch (nativeFetchError) {
    try {
      return await curlGet(url, headers);
    } catch {
      throw nativeFetchError; // curl fallback also failed — surface the original, more informative error
    }
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
