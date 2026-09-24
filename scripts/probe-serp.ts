/**
 * SERP thật của một từ khoá: ai đang chiếm top, và SERP có còn chỗ cho organic không.
 *
 *     tsx scripts/probe-serp.ts bong-da-nam "bảng xếp hạng ngoại hạng anh" ...
 *     tsx scripts/probe-serp.ts bong-da-nam --file danh-sach.txt
 *     (thêm --yes để chạy thật; không có --yes thì chỉ in chi phí ước tính)
 *
 * ═══ VÌ SAO KD KHÔNG ĐỦ ═══
 *
 * Đo 24/9/2026: `lịch thi đấu ngoại hạng anh` có 550.000 lượt/tháng ở **KD
 * 22**, và `kết quả ngoại hạng anh` 301.000 ở **KD 14**. Với head term cỡ đó
 * thì KD thấp như vậy là bất thường, và "bất thường" là lý do để đi nhìn chứ
 * không phải lý do để mừng.
 *
 * KD ước lượng độ khó từ hồ sơ backlink của các trang đang xếp hạng. Nó KHÔNG
 * nói hai điều quyết định việc có đáng làm hay không:
 *
 *   1. **Ai** đang ở đó. Mười trang DR thấp là cơ hội; mười trang của bốn tờ
 *      báo thể thao lớn thì KD thấp chỉ nói rằng họ không cần backlink để
 *      giữ chỗ.
 *   2. **Còn chỗ cho organic không.** Truy vấn lịch/kết quả là đúng loại mà
 *      Google tự trả lời bằng khối riêng của mình. Một SERP mà khối đó chiếm
 *      màn hình đầu thì vị trí #1 organic vẫn là vị trí dưới màn hình.
 *
 * Nên script này đọc CẢ hai: danh sách domain top 10, và các khối không phải
 * organic có mặt trên trang.
 *
 * ═══ CHI PHÍ ═══
 *
 * `serp/google/organic/live/advanced` tính tiền theo TỪNG truy vấn, không
 * theo lô như search_volume — nên 46 từ khoá ở đây KHÔNG phải một lô rẻ như
 * `keywords:measure`. In ước tính trước, và đòi --yes, cùng lý lẽ với lối vào
 * dòng lệnh mà Control Panel đã dựng.
 */
import fs from "node:fs";
import { getCredential } from "../lib/settings/credentials";
import { marketFor, hasExplicitMarket } from "../lib/keywords/markets";

const BASE = "https://api.dataforseo.com/v3";
/** Giá xấp xỉ mỗi truy vấn live/advanced. Dùng để CẢNH BÁO, không phải để
 *  quyết toán — bảng giá là của nhà cung cấp và có thể đổi. */
const USD_PER_QUERY = 0.002;

async function authHeader(): Promise<string> {
  const login = await getCredential("DATAFORSEO_LOGIN");
  const password = await getCredential("DATAFORSEO_PASSWORD");
  if (!login || !password) throw new Error("Chưa cấu hình DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD.");
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

interface SerpRow {
  keyword: string;
  organic: { rank: number; domain: string }[];
  /** Kiểu khối KHÔNG phải organic, kèm số lần xuất hiện. */
  features: Map<string, number>;
  total: number;
}

async function fetchSerp(auth: string, keyword: string, loc: number, lang: string): Promise<SerpRow> {
  const res = await fetch(`${BASE}/serp/google/organic/live/advanced`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify([{ keyword, location_code: loc, language_code: lang, depth: 20 }]),
  });
  if (!res.ok) throw new Error(`SERP "${keyword}" thất bại: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as Record<string, unknown>;
  const tasks = body.tasks as Record<string, unknown>[] | undefined;
  const result = tasks?.[0]?.result as Record<string, unknown>[] | undefined;
  const items = (result?.[0]?.items ?? []) as Record<string, unknown>[];

  const organic: { rank: number; domain: string }[] = [];
  const features = new Map<string, number>();
  for (const it of items) {
    const type = String(it.type ?? "?");
    if (type === "organic") {
      // rank_group, không phải rank_absolute: rank_absolute đếm cả khối quảng
      // cáo và khối đặc biệt, nên "#3" của nó không phải vị trí organic thứ 3.
      organic.push({ rank: Number(it.rank_group ?? 0), domain: String(it.domain ?? "?") });
    } else {
      features.set(type, (features.get(type) ?? 0) + 1);
    }
  }
  return { keyword, organic, features, total: items.length };
}

async function main(): Promise<void> {
  let args = process.argv.slice(2);
  const vertical = args.shift();
  if (!vertical) throw new Error('Dùng: tsx scripts/probe-serp.ts <nghề> [--file f | "kw" ...] [--yes]');

  const yes = args.includes("--yes");
  args = args.filter((a) => a !== "--yes");

  let keywords: string[];
  if (args[0] === "--file") {
    keywords = fs.readFileSync(args[1], "utf-8").split("\n").map((l) => l.trim());
  } else {
    keywords = args.map((a) => a.trim());
  }
  keywords = keywords.filter((k) => k && !k.startsWith("#"));
  if (keywords.length === 0) throw new Error("Không có từ khoá nào.");

  const market = marketFor(vertical);
  console.log(`  nghề      ${vertical}`);
  console.log(
    `  thị trường location_code=${market.locationCode} language_code=${market.languageCode}` +
      (hasExplicitMarket(vertical) ? "" : "  (chưa khai thị trường riêng — rơi về Hoa Kỳ/en)")
  );
  console.log(`  truy vấn  ${keywords.length}`);
  console.log(`  chi phí   ước tính $${(keywords.length * USD_PER_QUERY).toFixed(3)} (tính theo TỪNG truy vấn)`);
  if (!yes) {
    console.log("\n  Chưa gọi API. Thêm --yes để chạy thật.");
    return;
  }

  const auth = await authHeader();
  const rows: SerpRow[] = [];
  for (const k of keywords) {
    rows.push(await fetchSerp(auth, k, market.locationCode, market.languageCode));
  }

  for (const r of rows) {
    console.log(`\n── ${r.keyword}`);
    const top = r.organic.sort((a, b) => a.rank - b.rank).slice(0, 10);
    console.log(`   top 10 organic: ${top.map((o) => o.domain).join(", ") || "(không có)"}`);
    const feat = [...r.features.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`   khối KHÁC organic: ${feat.map(([t, n]) => `${t}×${n}`).join(", ") || "(không có)"}`);
    console.log(`   organic/tổng khối: ${r.organic.length}/${r.total}`);
  }

  // Domain nào xuất hiện ở nhiều truy vấn nhất — "ai sở hữu nhánh này".
  const byDomain = new Map<string, number>();
  for (const r of rows) {
    for (const d of new Set(r.organic.slice(0, 10).map((o) => o.domain))) {
      byDomain.set(d, (byDomain.get(d) ?? 0) + 1);
    }
  }
  console.log(`\n── Domain có mặt ở nhiều truy vấn nhất (trên ${rows.length})`);
  for (const [d, n] of [...byDomain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`   ${String(n).padStart(2)}/${rows.length}  ${d}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
