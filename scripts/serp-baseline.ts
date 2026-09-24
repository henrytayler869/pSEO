/**
 * Ai đang chiếm top cho các truy vấn NỀN TẢNG của một nghề.
 *
 *     npm run serp:baseline -- <vertical> <file.txt> [--yes]
 *
 * Chạy bởi pSEO Control Panel: đây là nghiên cứu niche, đầu vào để quyết
 * dựng Publisher thế nào. Không phải dữ liệu của một site đã dựng.
 *
 * MỘT TASK MỖI TRUY VẤN — endpoint SERP không nhận lô. Khoảng $0,002 mỗi
 * truy vấn; script in ước tính trước và đòi `--yes` nếu quá 10 truy vấn.
 */
import { readFileSync } from "node:fs";
import { fetchSerpForVertical } from "@/lib/keywords/serp";
import { marketFor, hasExplicitMarket } from "@/lib/keywords/markets";

const USD_PER_QUERY = 0.002;

async function main() {
  const [vertical, file, ...rest] = process.argv.slice(2);
  if (!vertical || !file) {
    console.error("Dùng: npm run serp:baseline -- <vertical> <file.txt | ->");
    process.exit(1);
  }
  const raw = file === "-" ? readFileSync(0, "utf-8") : readFileSync(file, "utf-8");
  const keywords = [...new Set(raw.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")))];
  if (keywords.length === 0) { console.error("Không có truy vấn nào."); process.exit(1); }

  const m = marketFor(vertical);
  console.log(`  nghề      ${vertical}${hasExplicitMarket(vertical) ? "" : "  (chưa khai thị trường riêng — rơi về Hoa Kỳ/en)"}`);
  console.log(`  thị trường location_code=${m.locationCode} language_code=${m.languageCode}`);
  console.log(`  truy vấn  ${keywords.length}`);
  console.log(`  chi phí   ước tính $${(keywords.length * USD_PER_QUERY).toFixed(3)}`);
  if (keywords.length > 10 && !rest.includes("--yes")) {
    console.error(`\n✗ Hơn 10 truy vấn. Thêm --yes nếu thật sự muốn chi $${(keywords.length * USD_PER_QUERY).toFixed(3)}.`);
    process.exit(1);
  }

  const { results, costUsd } = await fetchSerpForVertical(keywords, vertical);
  for (const r of results) {
    console.log(`\n  ── ${r.keyword}   (${r.totalResults ?? "?"} kết quả)`);
    for (const row of r.rows.slice(0, 10)) {
      console.log(`     ${String(row.position).padStart(2)}  ${row.domain.padEnd(28)} ${row.type !== "organic" ? "[" + row.type + "] " : ""}${row.title.slice(0, 54)}`);
    }
  }

  // Ai LẶP LẠI nhiều truy vấn mới là người sở hữu không gian này — một
  // domain đứng nhất một truy vấn có thể là ngẫu nhiên.
  const byDomain = new Map<string, number>();
  for (const r of results) for (const row of r.rows.slice(0, 10)) byDomain.set(row.domain, (byDomain.get(row.domain) ?? 0) + 1);
  console.log(`\n  ── DOMAIN xuất hiện nhiều nhất trong top 10 (trên ${results.length} truy vấn)`);
  for (const [d, n] of [...byDomain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`     ${String(n).padStart(3)}/${results.length}  ${d}`);
  }
  console.log(`\n  CHI PHÍ thật: $${costUsd.toFixed(4)}`);
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
