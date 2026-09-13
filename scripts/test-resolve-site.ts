// Kiểm chooseSite — phần quyết định "chạy trên site nào".
//
// Nhánh đáng kiểm nhất là nhánh TỪ CHỐI khi có nhiều site, và nó không thể
// chạm tới trên máy chỉ có một site. Không có file này thì nó ship mà chưa
// chạy lần nào — đúng cái bệnh mà helper sinh ra để chữa.

import { chooseSite, SiteAmbiguousError, type SiteRow } from "../lib/scripts/resolve-site";

const A: SiteRow = { url: "https://atmovingservices.com", vertical: "moving-services" };
const B: SiteRow = { url: "https://www.solarquotes.example", vertical: "solar-installers" };

let pass = 0;
const fails: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`✓ ${name}`);
  } catch (e) {
    fails.push(`${name}\n      ${e instanceof Error ? e.message : e}`);
    console.log(`✗ ${name}`);
  }
}

function eq(actual: unknown, expected: unknown, what: string) {
  if (actual !== expected) throw new Error(`${what}: nhận ${JSON.stringify(actual)}, cần ${JSON.stringify(expected)}`);
}

function throws(fn: () => unknown, contains: string) {
  let msg: string | null = null;
  try {
    fn();
  } catch (e) {
    if (!(e instanceof SiteAmbiguousError)) throw new Error(`ném sai loại lỗi: ${e}`);
    msg = e.message;
  }
  if (msg === null) throw new Error("không ném lỗi — nó đã chọn một site thay vì từ chối");
  if (!msg.includes(contains)) throw new Error(`thiếu "${contains}" trong: ${msg}`);
}

check("một site, không cờ → dùng nó", () => {
  eq(chooseSite([A], undefined).url, A.url, "site");
});

check("HAI site, không cờ → TỪ CHỐI, không lấy cái đầu", () => {
  throws(() => chooseSite([A, B], undefined), "phải nêu rõ chạy trên site nào");
});

check("lỗi từ chối liệt kê đủ cả hai site để copy được", () => {
  try {
    chooseSite([A, B], undefined);
  } catch (e) {
    const m = (e as Error).message;
    if (!m.includes("--site atmovingservices.com")) throw new Error("thiếu site A");
    if (!m.includes("--site solarquotes.example")) throw new Error("thiếu site B (www phải bị bỏ)");
    return;
  }
  throw new Error("không ném");
});

check("hai site, có cờ → chọn đúng cái được nêu", () => {
  eq(chooseSite([A, B], "solarquotes.example").url, B.url, "site");
});

check("cờ nhận cả URL đầy đủ", () => {
  eq(chooseSite([A, B], "https://atmovingservices.com/").url, A.url, "site");
});

check("cờ nhận cả dạng có www", () => {
  eq(chooseSite([A, B], "www.atmovingservices.com").url, A.url, "site");
});

check("cờ không khớp → TỪ CHỐI, không rơi về site nào", () => {
  // Nhánh này quan trọng riêng: người dùng đã nêu rõ một site. Rơi về
  // "lấy cái đầu" là làm đúng việc ở sai nơi, và không có gì báo.
  throws(() => chooseSite([A, B], "gõ-sai.com"), "Không có site nào khớp");
});

check("một site, cờ không khớp → vẫn TỪ CHỐI", () => {
  throws(() => chooseSite([A], "gõ-sai.com"), "Không có site nào khớp");
});

check("không site nào → nói rõ phải thêm ở /publisher", () => {
  throws(() => chooseSite([], undefined), "/publisher");
});

check("niche lọc hết → lỗi nêu tên niche, không nói chung chung", () => {
  throws(() => chooseSite([], undefined, "solar-installers"), 'niche "solar-installers"');
});

console.log(`\n${pass}/${pass + fails.length} đúng.`);
if (fails.length > 0) {
  console.error(`\nTRƯỢT:\n  ${fails.join("\n  ")}`);
  process.exitCode = 1;
}
