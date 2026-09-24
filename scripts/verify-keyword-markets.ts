/**
 * Cổng canh đường từ khoá đa thị trường.
 *
 * Ba thứ nó canh, mỗi thứ là một cách hỏng ĐÃ có thật hoặc suýt có:
 *
 * 1. TRẢ TIỀN MÀ VỨT. DataForSEO tính tiền theo TASK. Gửi ba mồi là ba lần
 *    trả. Bản trước của `extractRelatedKeywordItems` chỉ đọc task ĐẦU —
 *    đúng khi mỗi lần gọi một mồi, thành lỗi im lặng khi gửi nhiều mồi: kết
 *    quả của mồi thứ nhất là một danh sách hợp lệ, không gì đỏ lên.
 *
 * 2. MỒI SUY TỪ SLUG. `bong-da-nam` -> "bong da nam": không dấu, không ai
 *    gõ. DataForSEO vẫn trả dữ liệu trông hợp lệ cho truy vấn không tồn tại
 *    đó, và mọi tầng sau coi là cầu tìm kiếm thật.
 *
 * 3. NGHỀ MỸ BỊ ĐỔI HÀNH VI. 13 nghề đang chạy phải giữ nguyên vùng 2840,
 *    ngôn ngữ "en", và mồi suy từ slug.
 */
import { marketFor, hasExplicitMarket } from "../lib/keywords/markets";
import { extractRelatedKeywordItems } from "../lib/keywords/related-keywords";

let failed = 0;
function check(ok: boolean, label: string) {
  console.log(`    ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failed++;
}

const item = (kw: string) => ({
  depth: 1,
  keyword_data: {
    keyword: kw,
    keyword_info: { search_volume: 100, cpc: 0.1 },
    keyword_properties: { keyword_difficulty: 10 },
  },
});
const task = (kw: string) => ({ status_code: 20000, result: [{ items: [item(kw)] }] });

console.log("\n  đối chứng: gom MỌI task, không phải task đầu");
check(extractRelatedKeywordItems({ tasks: [task("a"), task("b"), task("c")] })?.length === 3,
  "3 mồi gửi đi -> 3 item đọc về (trả tiền 3 thì dùng 3)");
check(extractRelatedKeywordItems({ tasks: [task("a")] })?.length === 1, "1 mồi -> 1 item");
check(extractRelatedKeywordItems({ tasks: [{ status_code: 40501 }] }) === null,
  "MỌI task hỏng -> null, không phải mảng rỗng (rỗng đọc như 'nghề không có từ khoá')");
check(extractRelatedKeywordItems({ tasks: [{ status_code: 40501 }, task("b")] })?.length === 1,
  "một task hỏng một task tốt -> giữ task tốt");

console.log("\n  thị trường Việt Nam");
const vn = marketFor("bong-da-nam");
check(vn.locationCode === 2704 && vn.languageCode === "vi", `vùng 2704, ngôn ngữ vi`);
check(vn.seeds.length >= 3, `${vn.seeds.length} mồi, ở nhiều nhánh khác nhau`);
check(vn.seeds.every((s) => /[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(s)),
  "mọi mồi CÓ DẤU — mồi không dấu là truy vấn không ai gõ");
check(!vn.seeds.some((s) => s === "bong da nam"), "không mồi nào là slug suy ra");

console.log("\n  nghề Mỹ giữ nguyên hành vi");
for (const v of ["moving-services", "auto-accident-attorney"]) {
  const m = marketFor(v);
  check(m.locationCode === 2840 && m.languageCode === "en" && m.seeds.length === 1 && m.seeds[0] === v.replace(/-/g, " "),
    `${v}: 2840 / en / mồi "${m.seeds[0]}"`);
  check(!hasExplicitMarket(v), `${v}: không khai thị trường riêng`);
}

console.log(failed === 0 ? "\n✓ Tất cả phép kiểm xanh.\n" : `\n✗ ${failed} phép kiểm đỏ.\n`);
process.exit(failed === 0 ? 0 : 1);
