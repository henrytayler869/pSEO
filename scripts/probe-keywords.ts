// Ad-hoc keyword volume/CPC/KD probe for an explicit list of phrases.
//
// Exists because the per-market keyword pipeline derives its phrase from
// (vertical + Census Place name), which is the right default but can't
// answer "does anyone actually search for THIS wording?" — e.g. whether a
// borough name ("moving services brooklyn") has real demand versus the
// city name Census gives us ("moving services new york"), or whether a
// county name ("moving services cook county") is a phrase real people use
// at all. Those questions decide page granularity, so they need measured
// answers, not assumptions.
//
// Usage: tsx scripts/probe-keywords.ts "keyword one" "keyword two" ...
//        tsx scripts/probe-keywords.ts --file path/to/keywords.txt

import fs from "node:fs";
import { getCredential } from "../lib/settings/credentials";

const BASE = "https://api.dataforseo.com/v3";
const US_LOCATION_CODE = 2840;
const LANGUAGE_CODE = "en";

async function authHeader(): Promise<string> {
  const login = await getCredential("DATAFORSEO_LOGIN");
  const password = await getCredential("DATAFORSEO_PASSWORD");
  if (!login || !password) {
    throw new Error("Chưa cấu hình DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD (trang Cài đặt hoặc biến môi trường).");
  }
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

async function post(path: string, auth: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DataForSEO ${path} thất bại: ${res.status} ${res.statusText}`);
  return res.json();
}

function firstTaskResult(body: unknown): unknown {
  const tasks = (body as Record<string, unknown>)?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  const task = tasks[0] as Record<string, unknown>;
  if (task.status_code !== undefined && task.status_code !== 20000) {
    throw new Error(`DataForSEO task lỗi (${task.status_code}): ${task.status_message ?? "không rõ"}`);
  }
  return task.result ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  let keywords: string[];
  if (args[0] === "--file") {
    keywords = fs.readFileSync(args[1], "utf-8").split("\n").map((l) => l.trim()).filter(Boolean);
  } else {
    keywords = args.map((a) => a.trim()).filter(Boolean);
  }
  if (keywords.length === 0) {
    console.error('Cách dùng: tsx scripts/probe-keywords.ts "từ khoá 1" "từ khoá 2" ...');
    process.exitCode = 1;
    return;
  }

  const auth = await authHeader();
  const payload = [{ keywords, location_code: US_LOCATION_CODE, language_code: LANGUAGE_CODE }];

  const [volBody, kdBody] = await Promise.all([
    post("/keywords_data/google_ads/search_volume/live", auth, payload),
    post("/dataforseo_labs/google/bulk_keyword_difficulty/live", auth, payload),
  ]);

  const volRows = firstTaskResult(volBody);
  const volByKw = new Map<string, { sv: number | null; cpc: number | null }>();
  if (Array.isArray(volRows)) {
    for (const r of volRows as Record<string, unknown>[]) {
      volByKw.set(String(r.keyword).toLowerCase(), {
        sv: typeof r.search_volume === "number" ? r.search_volume : null,
        cpc: typeof r.cpc === "number" ? r.cpc : null,
      });
    }
  }

  const kdResult = firstTaskResult(kdBody);
  const kdByKw = new Map<string, number | null>();
  const items = Array.isArray(kdResult) && kdResult.length > 0 ? (kdResult[0] as Record<string, unknown>).items : null;
  if (Array.isArray(items)) {
    for (const it of items as Record<string, unknown>[]) {
      kdByKw.set(String(it.keyword).toLowerCase(), typeof it.keyword_difficulty === "number" ? it.keyword_difficulty : null);
    }
  }

  console.log("keyword\tsearch_volume\tcpc\tkd");
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    const v = volByKw.get(k);
    const kd = kdByKw.get(k);
    const sv = v?.sv ?? null;
    console.log(`${kw}\t${sv === null ? "no-data" : sv}\t${v?.cpc ?? "-"}\t${kd ?? "-"}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
