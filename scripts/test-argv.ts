// Kiểm positionals/numberArg.
//
// Viết sau một lỗi im lặng đã đo: generate-cluster-text đọc số lượng bằng
// Number(argv[2]); thêm --site vào là argv[2] thành "--site", Number() cho
// NaN, slice(0, NaN) cho mảng rỗng — script in "31 cụm" và sinh 0 đoạn,
// không lỗi nào. Ca "cờ đứng trước số" bên dưới chính là ca đó.

import fs from "node:fs";
import path from "node:path";
import { positionals, numberArg, BadArgError, VALUE_FLAGS } from "../lib/scripts/argv";

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

check("giá trị của --via không lọt vào tham số vị trí", () => {
  // Ca ĐÃ XẢY RA 25/9/2026: issue-publisher-key.ts thêm --via mà quên
  // VALUE_FLAGS, nên nhãn khoá lưu thành id của site trung chuyển.
  eq(positionals(argv("--site", "a.com", "--via", "cmt123", "nhãn")), ["nhãn"], "positionals");
});

/**
 * CỔNG CHỐNG TÁI DIỄN, không phải một ca nữa.
 *
 * Ca ở trên chỉ canh đúng cờ tôi vừa thêm. Lỗi thật thì ở chỗ khác: người thêm
 * cờ MỚI vào một script cũng sẽ không nghĩ tới lib/scripts/argv.ts, y như lần
 * này — và hậu quả im lặng (một nhãn sai, hoặc ở script khác là một con số bị
 * nuốt) nên không có gì đỏ lên để nhắc họ.
 *
 * Nên quét thay vì liệt kê: file nào gọi positionals() thì mọi cờ ĐỌC GIÁ TRỊ
 * trong đó phải có trong VALUE_FLAGS. "Đọc giá trị" nhận ra bằng chính hình
 * dạng code đang dùng — `indexOf("--x")` rồi lấy phần tử `+ 1`. Cờ boolean
 * (`--yes`, `--dry`) không khớp hình dạng đó, và đúng là chúng KHÔNG được vào
 * VALUE_FLAGS: cho vào thì chúng nuốt tham số đứng sau.
 */
check("mọi cờ đọc-giá-trị trong script dùng positionals() đều đã khai", () => {
  const dir = path.join(process.cwd(), "scripts");
  const offenders: string[] = [];
  let scanned = 0;
  let flagsSeen = 0;

  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf-8");
    if (!/\bpositionals\s*\(/.test(src)) continue;
    scanned++;
    for (const m of src.matchAll(/indexOf\("(--[a-z0-9-]+)"\)([\s\S]{0,160})/g)) {
      const [, flag, after] = m;
      if (!/\+\s*1\s*\]/.test(after)) continue; // cờ boolean: không lấy phần tử kế
      flagsSeen++;
      if (!VALUE_FLAGS.has(flag)) offenders.push(`${f}: ${flag}`);
    }
  }

  // ĐỐI CHỨNG DƯƠNG. Không có nó thì một regex hỏng — hay một lần đổi tên thư
  // mục — cho ra "0 vi phạm" và đọc y hệt "đã quét xong, sạch".
  if (scanned === 0) throw new Error("không quét được script nào — phép kiểm này đang không kiểm gì");
  if (flagsSeen === 0) throw new Error(`quét ${scanned} file mà không thấy cờ đọc-giá-trị nào — regex hỏng`);

  if (offenders.length > 0) {
    throw new Error(
      `cờ đọc giá trị nhưng thiếu trong VALUE_FLAGS (lib/scripts/argv.ts): ${offenders.join(", ")}` +
        " — giá trị của chúng sẽ lọt vào positionals() và im lặng thành tham số vị trí"
    );
  }
});

console.log(`\n${pass}/${pass + fails.length} đúng.`);
if (fails.length > 0) { console.error(`\nTRƯỢT:\n  ${fails.join("\n  ")}`); process.exitCode = 1; }
