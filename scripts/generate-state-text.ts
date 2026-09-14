// Sinh đoạn diễn giải cho trang HUB BANG.
//
// Vì sao cần: đo 14/9/2026 trên atmovingservices, đếm TỪ hiển thị theo độ sâu
//   158 trang thị trường   891 - 1.295 từ   khoẻ
//    26 trang hub bang     111 -   541 từ   MỎNG, giữa 225
// Và trong 4 trang Google đã crawl rồi KHÔNG lấy, hai trang là hub
// (/moving-services/oh, /moving-services/tx). Google đọc hub mỏng rồi từ
// chối, trong khi 158 trang dày thì chưa crawl tới.
//
// Dùng lại NGUYÊN bộ máy cụm, không dựng bảng mới: hub bang và trang cụm là
// cùng một bài toán — nhiều ZIP, một trang, không có "giá trị của nơi này",
// nên thứ nói được là DẢI. buildClusterFactSet đã dựng dải kèm tên ZIP ở mỗi
// đầu, validateClusterText đã cấm nói đầu dải như giá trị cả vùng, và
// clusterIdOf băm theo tập ZIP nên tập của một bang là một danh tính hợp lệ.
//
// Mặc định CHẠY KHÔ.

import { prisma } from "../lib/db/prisma";
import { fetchServedInventory } from "../lib/publisher/inventory";
import { generateForCluster } from "../lib/ai/cluster-generate";
import { SpendCapExceededError } from "../lib/ai/anthropic";
import { getBudgetStatus } from "../lib/ai/budget";
import { resolveSite, reportSiteError } from "../lib/scripts/resolve-site";
import { numberArg, reportArgError } from "../lib/scripts/argv";

/** Đo trên đoạn cụm: ~$0,047 mỗi đoạn hoàn chỉnh. Hub bang có nhiều ZIP hơn
 * nên prompt dài hơn — ước tính rộng tay. */
const EST_USD_PER_STATE = 0.06;

/** Dưới ngưỡng này thì "dải" không có gì để nói và trang cũng không mỏng vì
 * lý do nội dung. Một bang có 1 ZIP thì hub của nó gần như là trang ZIP. */
const MIN_ZIPS = 2;

async function main() {
  const apply = process.argv.includes("--apply");
  const limit = numberArg(0, Number.POSITIVE_INFINITY);
  const site = await resolveSite<{ id: string; url: string; vertical: string }>();

  const inv = await fetchServedInventory(site.url);

  // Gom ZIP theo BANG, lấy từ đường dẫn trong inventory — cùng nguồn mà site
  // dùng để dựng trang, nên hai bên không thể lệch tập. Lệch tập là 404 im
  // lặng: endpoint khớp đúng toàn bộ tập (guide §3.7c).
  const byState = new Map<string, string[]>();
  for (const [zip, path] of inv.byZip) {
    const seg = path.split("/").filter(Boolean);
    if (seg.length < 2) continue;
    const state = seg[1];
    byState.set(state, [...(byState.get(state) ?? []), zip]);
  }

  // Bang mà MỌI ZIP nằm trong đúng MỘT trang cụm: tập của bang bằng hệt tập
  // của cụm, nên sinh cho nó là sinh lại đúng đoạn của trang cụm — và cả hai
  // trang sẽ đăng cùng một đoạn. Publisher đã chặn ở phía render, nhưng chặn
  // ở đây nữa để dòng báo không nói dối: "đã có, bỏ qua" nghe như hub đã có
  // đoạn của nó, trong khi thứ đang có là đoạn của trang con.
  const clusterSets = new Map<string, Set<string>>();
  for (const [zip, path] of inv.byZip) {
    if (inv.kindByZip.get(zip) !== "cluster") continue;
    clusterSets.set(path, new Set([...(clusterSets.get(path) ?? []), zip]));
  }
  const sameAsCluster = (zips: string[]) =>
    [...clusterSets.values()].some((set) => set.size === zips.length && zips.every((z) => set.has(z)));

  const states = [...byState]
    .map(([state, zips]) => ({ state, zips: [...zips].sort(), path: `/${inv.byZip.values().next().value?.split("/").filter(Boolean)[0] ?? "moving-services"}/${state}` }))
    .filter((s) => s.zips.length >= MIN_ZIPS)
    .filter((s) => {
      if (!sameAsCluster(s.zips)) return true;
      console.log(`  bỏ qua ${s.path} — mọi ZIP của bang nằm trong đúng một trang cụm, đoạn sẽ trùng trang đó`);
      return false;
    })
    .sort((a, b) => b.zips.length - a.zips.length);

  const skipped = [...byState].filter(([, z]) => z.length < MIN_ZIPS);

  console.log(`${byState.size} bang trong inventory | đủ ${MIN_ZIPS}+ ZIP: ${states.length}`);
  if (skipped.length > 0) {
    // Nói ra thay vì lặng lẽ bỏ: một bang bị bỏ qua vì quá ít ZIP vẫn là một
    // hub mỏng, chỉ là không chữa được bằng cách này.
    console.log(`  bỏ qua ${skipped.length} bang chỉ có 1 ZIP: ${skipped.map(([s]) => s).join(", ")}`);
  }
  const targets = states.slice(0, Number.isFinite(limit) ? limit : states.length);
  console.log(`sẽ sinh ${targets.length}, ước tính ~$${(targets.length * EST_USD_PER_STATE).toFixed(2)}\n`);

  const b = await getBudgetStatus(site.id);
  if (b?.verdict === "over") console.log(`⛔ Publisher đã vượt ngân sách: $${b.totalUsd.toFixed(4)} / $${b.budgetUsd!.toFixed(2)}\n`);

  for (const t of targets.slice(0, 6)) console.log(`  ${t.path.padEnd(28)} ${String(t.zips.length).padStart(3)} ZIP`);
  if (targets.length > 6) console.log(`  … và ${targets.length - 6} bang nữa`);

  if (!apply) {
    console.log("\n--dry (mặc định): chưa gọi model. Thêm --apply để chạy thật.");
    await prisma.$disconnect();
    return;
  }

  let ok = 0, failed = 0, cached = 0, cost = 0;
  console.log();
  for (const t of targets) {
    try {
      const r = await generateForCluster(site.vertical, t.zips, t.path, site.id);
      if (!r) { failed++; console.log(`  ✗ ${t.path} — không dựng được fact set (dưới 2 ZIP có dữ liệu)`); continue; }
      cost += r.costUsd;
      if (r.attempts === 0) { cached++; console.log(`  · ${t.path} — đã có, bỏ qua`); continue; }
      if (r.passed) { ok++; console.log(`  ✓ ${t.path.padEnd(28)} ${t.zips.length} ZIP  ${r.attempts} lần  $${r.costUsd.toFixed(4)}`); }
      else { failed++; console.log(`  ✗ ${t.path} — trượt sau ${r.attempts} lần: ${r.issues[0]?.slice(0, 90)}`); }
    } catch (err) {
      if (err instanceof SpendCapExceededError) { console.log(`\n  CHẠM TRẦN CHI TIÊU — dừng.`); break; }
      throw err;
    }
  }
  console.log(`\nsinh mới ${ok} | đã có ${cached} | trượt ${failed} | chi phí $${cost.toFixed(4)}`);
  await prisma.$disconnect();
}

main().catch((err) => { if (reportSiteError(err) || reportArgError(err)) return; throw err; });
