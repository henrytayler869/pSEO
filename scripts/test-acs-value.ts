import { parseAcsValue, assertNonEmptyUniverse, EmptyUniverseError, SUPPRESSED_VALUE } from "@/lib/collector/acs-value";

/**
 * Chạy: npm run test:acs-value
 *
 * Không mạng, không DB. Mọi ô dưới đây là hình dạng THẬT chụp từ
 * api.census.gov ACS5 2023 ngày 27/9/2026, không phải ca bịa.
 *
 * Hai thứ nó canh, và cả hai đã hỏng im lặng trong production:
 *
 *   1. `Number(null) === 0`. Ô vắng ước lượng thành một số 0 THẬT, qua sạch mọi
 *      phép kiểm hữu hạn/không âm/không-sentinel. 270 hàng DataPoint đã mang số
 *      0 kiểu đó.
 *   2. Số 0 CÓ vũ trụ vẫn là dữ liệu. Washington DC chỉ có một hạt, nên "đến từ
 *      hạt khác trong cùng bang = 0" là SỰ THẬT và phải sống sót. Một bản vá vơ
 *      đũa cả nắm sẽ xoá mất nó, và khi đó phép sửa lỗi im lặng lại tạo ra một
 *      lỗ im lặng khác.
 */

let pass = 0;
const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`✓ ${name}`);
  } catch (e) {
    fails.push(`${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}
function eq(got: unknown, want: unknown, label: string) {
  if (got !== want) throw new Error(`${label}: nhận ${JSON.stringify(got)}, cần ${JSON.stringify(want)}`);
}

// ───────────────────────── parseAcsValue ─────────────────────────

check("null -> null, KHÔNG phải 0  (đây là cả lý do file này tồn tại)", () => {
  eq(parseAcsValue(null), null, "parseAcsValue(null)");
  // Chứng minh ngay tại chỗ điều bản cũ làm sai, để ca này không đọc như một
  // phép kiểm hình thức:
  eq(Number(null), 0, "Number(null)");
  eq(Number.isFinite(Number(null)), true, "Number(null) hữu hạn");
});

check("undefined và chuỗi rỗng cũng là null", () => {
  eq(parseAcsValue(undefined), null, "undefined");
  eq(parseAcsValue(""), null, "chuỗi rỗng");
  eq(parseAcsValue("   "), null, "chuỗi khoảng trắng");
});

check("số 0 THẬT vẫn là 0 — không được vạ lây", () => {
  // ZIP 20002 (DC): moved_from_different_county = 0, và đó là số đúng.
  eq(parseAcsValue(0), 0, "số 0");
  eq(parseAcsValue("0"), 0, "chuỗi \"0\"");
});

check("sentinel nén của Census -> null", () => {
  eq(parseAcsValue(SUPPRESSED_VALUE), null, "-666666666");
  eq(parseAcsValue(String(SUPPRESSED_VALUE)), null, "dạng chuỗi");
});

check("giá trị thật đi qua nguyên vẹn", () => {
  // ZIP 77494 (Katy, TX), đo thật.
  eq(parseAcsValue("136444"), 136444, "tổng");
  eq(parseAcsValue("450100"), 450100, "giá nhà");
  eq(parseAcsValue(1977), 1977, "năm xây");
});

check("âm và không-phải-số -> null", () => {
  eq(parseAcsValue(-5), null, "âm");
  eq(parseAcsValue("N/A"), null, "chữ");
  eq(parseAcsValue({}), null, "object");
});

// ────────────────────── assertNonEmptyUniverse ──────────────────────

check("vũ trụ null -> NÉM  (Puerto Rico, B07003 không phủ)", () => {
  let threw: unknown = null;
  try {
    assertNonEmptyUniverse(null, { zip: "00725", table: "B07003" });
  } catch (e) {
    threw = e;
  }
  if (!(threw instanceof EmptyUniverseError)) throw new Error("không ném — bốn số 0 sẽ thành bốn DataPoint");
  if (!String((threw as Error).message).includes("00725")) throw new Error("thông báo không nêu ZIP");
});

check("vũ trụ 0 -> NÉM  (43218 Columbus, ZIP hộp thư)", () => {
  let threw = false;
  try {
    assertNonEmptyUniverse(0, { zip: "43218", table: "B25003" });
  } catch (e) {
    threw = e instanceof EmptyUniverseError;
  }
  if (!threw) throw new Error("không ném — median home value 0 USD sẽ vào DB");
});

check("ĐỐI CHỨNG DƯƠNG: vũ trụ thật -> KHÔNG ném, kể cả khi thành phần bằng 0", () => {
  // ZIP 20002 (DC): tổng 69.487 người, nhưng moved_from_different_county = 0.
  // Đây là ca mà một bản vá cẩu thả sẽ giết nhầm.
  assertNonEmptyUniverse(69487, { zip: "20002", table: "B07003" });
  eq(parseAcsValue(0), 0, "thành phần 0 vẫn giữ nguyên");
});

check("vũ trụ = 1 vẫn đi qua — ngưỡng là RỖNG, không phải NHỎ", () => {
  assertNonEmptyUniverse(1, { zip: "99999", table: "B07003" });
});

check("thông báo lỗi nói RÕ nó là chỗ trống, không phải phép đo", () => {
  try {
    assertNonEmptyUniverse(null, { zip: "00926", table: "B07003" });
    throw new Error("không ném");
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (!m.includes("CHỖ TRỐNG")) throw new Error(`thông báo không phân biệt được hai loại số 0: ${m}`);
  }
});

console.log(`\n${pass}/${pass + fails.length} đạt.`);
if (fails.length > 0) {
  console.error(`\nTRƯỢT:\n  ${fails.join("\n  ")}`);
  process.exitCode = 1;
}
