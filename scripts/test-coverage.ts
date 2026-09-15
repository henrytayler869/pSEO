import { groupByPage, summarize, exitCodeFor, type InventoryEntry, type PageCoverage } from "@/lib/ai/coverage";

let pass = 0;
const fail: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

// ---- gộp entry theo trang ----
const entries: InventoryEntry[] = [
  { zip: "32822", path: "/m/fl/orlando-32822", kind: "market" },
  { zip: "11212", path: "/m/ny/brooklyn", kind: "cluster" },
  { zip: "11201", path: "/m/ny/brooklyn", kind: "cluster" },
  { zip: "11203", path: "/m/ny/brooklyn", kind: "cluster" },
];
const pages = groupByPage(entries);
check("4 ZIP gộp thành 2 trang", pages.length === 2, `thấy ${pages.length}`);
const bk = pages.find((p) => p.path === "/m/ny/brooklyn")!;
check("cụm giữ đủ 3 ZIP thành viên", bk.zips.length === 3);
check(
  "ZIP thành viên được SẮP XẾP",
  bk.zips.join(",") === "11201,11203,11212",
  "clusterIdOf băm tập đã sắp xếp — thứ tự khác là cụm khác"
);
check("ZIP trùng không bị đếm hai lần", groupByPage([...entries, entries[1]]).find((p) => p.path === "/m/ny/brooklyn")!.zips.length === 3);
check("trang rỗng vào thì ra rỗng", groupByPage([]).length === 0);

// ---- tổng hợp ----
const mk = (state: PageCoverage["state"]): PageCoverage => ({ path: "/x", kind: "market", zips: ["1"], state });
const r = summarize([mk("fresh"), mk("stale"), mk("stale"), mk("never")]);
check("đếm đúng ba trạng thái", r.fresh === 1 && r.stale === 2 && r.never === 1);

// ---- quyết định của cổng ----
check("có trang mất chữ → ĐỎ", exitCodeFor({ fresh: 57, stale: 101, never: 0 }) === 1);
check("đúng một trang mất chữ → ĐỎ", exitCodeFor({ fresh: 157, stale: 1, never: 0 }) === 1);
check("không trang nào mất chữ → xanh", exitCodeFor({ fresh: 158, stale: 0, never: 0 }) === 0);
check(
  "CHƯA LÀM thì KHÔNG đỏ",
  exitCodeFor({ fresh: 0, stale: 0, never: 158 }) === 0,
  "gộp 'còn phải làm' vào cảnh báo hồi quy là cách biến cảnh báo thành thứ người ta tắt"
);
check("chưa làm nhiều nhưng có mất chữ → vẫn ĐỎ", exitCodeFor({ fresh: 0, stale: 1, never: 157 }) === 1);

console.log(fail.length ? `\n✗ ${fail.length} trượt:\n  ${fail.join("\n  ")}\n` : "");
console.log(`${pass}/${pass + fail.length} đạt.`);
process.exit(fail.length ? 1 : 0);
