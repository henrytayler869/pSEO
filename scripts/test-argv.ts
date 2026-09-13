// Kiểm positionals/numberArg.
//
// Viết sau một lỗi im lặng đã đo: generate-cluster-text đọc số lượng bằng
// Number(argv[2]); thêm --site vào là argv[2] thành "--site", Number() cho
// NaN, slice(0, NaN) cho mảng rỗng — script in "31 cụm" và sinh 0 đoạn,
// không lỗi nào. Ca "cờ đứng trước số" bên dưới chính là ca đó.

import { positionals, numberArg, BadArgError } from "../lib/scripts/argv";

const argv = (...rest: string[]) => ["node", "script.ts", ...rest];

let pass = 0;
const fails: string[] = [];

function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fails.push(`${name}\n      ${e instanceof Error ? e.message : e}`); console.log(`✗ ${name}`); }
}
function eq(a: unknown, b: unknown, what: string) {
  const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
  if (x !== y) throw new Error(`${what}: nhận ${x}, cần ${y}`);
}

check("cờ ĐỨNG TRƯỚC số — ca đã gây lỗi im lặng", () => {
  eq(numberArg(0, 99, argv("--site", "a.com", "5")), 5, "limit");
});

check("cờ đứng SAU số", () => {
  eq(numberArg(0, 99, argv("5", "--site", "a.com")), 5, "limit");
});

check("số 0 không bị nuốt thành mặc định", () => {
  // 0 là falsy. `Number(x) || fallback` sẽ biến "chạy 0 cụm" thành "chạy
  // tất cả" — ngược hẳn ý người gõ, và tốn tiền.
  eq(numberArg(0, 99, argv("--site", "a.com", "0")), 0, "limit");
});

check("vắng số → mặc định", () => {
  eq(numberArg(0, 99, argv("--site", "a.com")), 99, "limit");
});

check("số gõ sai → NÉM LỖI, không rơi về mặc định", () => {
  let threw = false;
  try { numberArg(0, 99, argv("--site", "a.com", "abc")); }
  catch (e) { threw = e instanceof BadArgError; }
  if (!threw) throw new Error("không ném — nó chạy tiếp với giá trị khác câu lệnh người dùng gõ");
});

check("giá trị của --site không lọt vào tham số vị trí", () => {
  // Ca của record-manual-index: "a.com" từng bị coi là một URL cần ghi.
  eq(positionals(argv("--site", "a.com", "/x", "/y")), ["/x", "/y"], "positionals");
});

check("giá trị của --file cũng vậy", () => {
  eq(positionals(argv("--file", "urls.txt", "/x")), ["/x"], "positionals");
});

check("cờ boolean không nuốt tham số theo sau", () => {
  // --dry KHÔNG nhận giá trị; nuốt "/x" sẽ làm mất một URL trong im lặng.
  eq(positionals(argv("--dry", "/x", "/y")), ["/x", "/y"], "positionals");
});

check("không cờ nào → mọi thứ là tham số vị trí", () => {
  eq(positionals(argv("/x", "/y")), ["/x", "/y"], "positionals");
});

console.log(`\n${pass}/${pass + fails.length} đúng.`);
if (fails.length > 0) { console.error(`\nTRƯỢT:\n  ${fails.join("\n  ")}`); process.exitCode = 1; }
