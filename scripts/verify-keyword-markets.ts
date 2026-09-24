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
import { marketFor, hasExplicitMarket, verticalsWithExplicitMarket } from "../lib/keywords/markets";
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
/**
 * ÍT NHẤT MỘT mồi có dấu — trước đây đòi MỌI mồi, và điều đó đã sai.
 *
 * Luật cũ đúng khi mọi mồi là cụm tiếng Việt. Nhưng đo 24/9/2026 cho thấy
 * hai loại mồi hợp lệ KHÔNG có dấu, và cả hai đều là chữ người Việt thật sự
 * gõ:
 *
 *     "mu vs liverpool"    <- chính mồi đã chứng minh người Việt gõ `vs`
 *     "manchester united"  <- tên CLB, vốn là chữ Latin
 *
 * Bắt mọi mồi phải có dấu sẽ loại đúng cái mồi đắt giá nhất trong đợt đo.
 *
 * Thứ luật này sinh ra để chặn là mồi suy từ slug (`bong da nam`) — một cụm
 * tiếng Việt bị bỏ dấu. Phép kiểm ngay dưới đã bắt CHÍNH nó, chính xác và
 * không cần suy đoán. Nên ở đây chỉ giữ lại phần proxy còn có ích: danh sách
 * phải chứa tiếng Việt thật, chứ không phải toàn chuỗi không dấu.
 */
check(vn.seeds.some((s) => /[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(s)),
  "có mồi mang dấu — danh sách không phải toàn chuỗi bỏ dấu");
/**
 * Mồi suy từ slug — kiểm cho MỌI nghề, không chỉ cho `bong-da-nam`.
 *
 * Bản trước viết cứng đúng một chuỗi. Nó đủ khi luật "mọi mồi có dấu" còn
 * đứng, vì luật ấy phủ rộng. Nhưng luật đó vừa được nới (xem ngay trên), nên
 * phép kiểm này trở thành phòng tuyến DUY NHẤT còn lại — và một phòng tuyến
 * duy nhất mà chỉ canh một nghề thì nghề Việt thứ hai đi qua sạch sẽ.
 *
 * Nới một luật thì phải siết luật mà nó vừa để lộ ra. Đây là chỗ đó.
 */
for (const v of verticalsWithExplicitMarket()) {
  const slugSeed = v.replace(/-/g, " ");
  check(!marketFor(v).seeds.includes(slugSeed), `${v}: không mồi nào trùng chuỗi suy từ slug ("${slugSeed}")`);
}

console.log("\n  nghề Mỹ giữ nguyên hành vi");
for (const v of ["moving-services", "auto-accident-attorney"]) {
  const m = marketFor(v);
  check(m.locationCode === 2840 && m.languageCode === "en" && m.seeds.length === 1 && m.seeds[0] === v.replace(/-/g, " "),
    `${v}: 2840 / en / mồi "${m.seeds[0]}"`);
  check(!hasExplicitMarket(v), `${v}: không khai thị trường riêng`);
}

console.log(failed === 0 ? "\n✓ Tất cả phép kiểm xanh.\n" : `\n✗ ${failed} phép kiểm đỏ.\n`);
process.exit(failed === 0 ? 0 : 1);
