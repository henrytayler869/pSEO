/**
 * Cổng canh trục trang KHÔNG địa lý.
 *
 * Kiểm BA thứ, và cả ba đều là "so với thực tế" chứ không phải "so với chính
 * mình" — bài học chung của ba cái bẫy ở docs/VN_FOOTBALL_PUBLISHER_BRIEF.md
 * mục 6.
 *
 *   1. Khoá dựng từ TÊN ĐỘI THẬT của nguồn: không rỗng, không ký tự lạ, không
 *      hai đội chung một slug. Một phép kiểm trên tên tự bịa sẽ xanh mãi mãi.
 *   2. Cặp đối đầu KHÔNG THỨ TỰ, và đọc ngược ra đúng axis. Số cặp phải khớp
 *      C(n,2) của chính giải đó — kiểm được bằng số học, không cần nguồn hai.
 *   3. Database chỉ chứa `axis` đã khai, `parentKey` trỏ tới `key` có thật, và
 *      KHÔNG hàng nào mang axis dành riêng cho trục địa lý.
 *
 * Phần 1-2 đọc mạng nên KHÔNG vào CI — cùng lý lẽ với verify:openfootball:
 * một lần GitHub trục trặc sẽ làm đỏ PR của mọi session mà không nói gì về
 * code. Phần 3 đọc database, cũng không vào CI.
 *
 *     npm run verify:page-axis
 */
import {
  AXES_BY_VERTICAL,
  FOOTBALL_VERTICAL,
  RESERVED_AXES,
  axesFor,
  fixtureKey,
  isKnownAxis,
  parseKey,
  teamKey,
  teamSlug,
} from "@/lib/page-axis/axes";
import { LEAGUES, fetchLeagueSeason, type LeagueCode } from "@/lib/football/openfootball";
import { currentEuropeanSeason } from "@/lib/football/season";
import { prisma } from "@/lib/db/prisma";

let failures = 0;
const fail = (msg: string) => {
  console.error(`  ✗ ${msg}`);
  failures++;
};

async function checkKeysAgainstRealTeams(): Promise<void> {
  console.log("── 1+2. Khoá dựng từ tên đội THẬT ────────────────────────────");
  const now = new Date();
  const season = currentEuropeanSeason(now);
  let teams = 0;
  let pairs = 0;

  for (const code of Object.keys(LEAGUES) as LeagueCode[]) {
    const s = await fetchLeagueSeason(code, season, now);
    const bySlug = new Map<string, string>();

    for (const t of s.teams) {
      const slug = teamSlug(t);
      if (!slug) fail(`${code}: "${t}" cho ra slug RỖNG`);
      else if (!/^[a-z0-9-]+$/.test(slug)) fail(`${code}: "${t}" -> "${slug}" có ký tự ngoài [a-z0-9-]`);
      const clash = bySlug.get(slug);
      if (clash && clash !== t) fail(`${code}: "${clash}" và "${t}" cùng slug "${slug}"`);
      bySlug.set(slug, t);

      const parsed = parseKey(teamKey(code, t));
      if (parsed?.axis !== "team" || parsed.team !== slug) fail(`${code}: teamKey("${t}") không đọc ngược được`);
    }
    teams += s.teams.length;

    const seen = new Set<string>();
    for (let i = 0; i < s.teams.length; i++) {
      for (let j = i + 1; j < s.teams.length; j++) {
        const forward = fixtureKey(code, s.teams[i], s.teams[j]);
        const reverse = fixtureKey(code, s.teams[j], s.teams[i]);
        if (forward !== reverse) fail(`${code}: cặp có thứ tự — ${forward} != ${reverse}`);
        if (parseKey(forward)?.axis !== "fixture") fail(`${code}: fixtureKey không đọc ngược được — ${forward}`);
        seen.add(forward);
      }
    }
    const expected = (s.teams.length * (s.teams.length - 1)) / 2;
    if (seen.size !== expected) fail(`${code}: ${seen.size} cặp, C(${s.teams.length},2)=${expected}`);
    pairs += seen.size;

    console.log(
      `  ${code.padEnd(5)} ${String(s.teams.length).padStart(2)} đội  ${String(seen.size).padStart(3)} cặp` +
        `  trễ ${s.stalenessDays ?? "?"} ngày`
    );
  }
  console.log(`  TỔNG ${teams} đội, ${pairs} cặp`);
}

async function checkDatabaseRows(): Promise<void> {
  console.log("\n── 3. Hàng trong database ────────────────────────────────────");
  const rows = await prisma.entityIdentity.findMany({
    select: { vertical: true, axis: true, key: true, parentKey: true },
  });
  if (rows.length === 0) {
    console.log("  (chưa hàng nào — không có gì để kiểm, và đó KHÔNG phải 'đã kiểm, sạch')");
    return;
  }

  const keysByVertical = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!keysByVertical.has(r.vertical)) keysByVertical.set(r.vertical, new Set());
    keysByVertical.get(r.vertical)!.add(r.key);
  }

  for (const r of rows) {
    if (RESERVED_AXES.includes(r.axis)) {
      fail(`axis "${r.axis}" thuộc trục ĐỊA LÝ — danh tính của nó nằm ở MarketIdentity/Location, không ở đây (${r.key})`);
    } else if (!isKnownAxis(r.vertical, r.axis)) {
      const known = axesFor(r.vertical).map((a) => a.axis).join(", ") || "(chưa khai axis nào)";
      fail(`axis "${r.axis}" không khai cho vertical "${r.vertical}" — đang khai: ${known} (${r.key})`);
    }
    if (r.parentKey !== null && !keysByVertical.get(r.vertical)!.has(r.parentKey)) {
      fail(`parentKey "${r.parentKey}" không trỏ tới key nào có thật trong vertical "${r.vertical}" (${r.key})`);
    }
  }
  console.log(`  ${rows.length} hàng, ${keysByVertical.size} vertical`);
}

async function main(): Promise<void> {
  console.log(`Trục khai trong mã: ${Object.keys(AXES_BY_VERTICAL).join(", ")}`);
  console.log(`  ${FOOTBALL_VERTICAL}: ${axesFor(FOOTBALL_VERTICAL).map((a) => a.axis).join(" -> ")}\n`);
  await checkKeysAgainstRealTeams();
  await checkDatabaseRows();

  console.log("");
  if (failures > 0) {
    console.error(`ĐỎ — ${failures} vấn đề.`);
    process.exit(1);
  }
  console.log("XANH — mọi bất biến của trục trang còn đứng.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
