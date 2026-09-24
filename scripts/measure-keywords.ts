/**
 * Đo lượt tìm + độ khó cho một danh sách từ khoá, ở thị trường của nghề.
 *
 *     npm run keywords:measure -- <vertical> <file.txt>
 *     npm run keywords:measure -- bong-da-nam candidates.txt
 *     cat candidates.txt | npm run keywords:measure -- bong-da-nam -
 *
 * File: mỗi dòng một từ khoá, dòng rỗng và dòng bắt đầu bằng `#` bị bỏ qua.
 *
 * ═══ AI CHẠY CÁI NÀY ═══
 *
 * Phiên SEO của từng publisher. Control Panel dựng công cụ; việc CHỌN từ
 * khoá nào đáng đo là quyết định về nội dung của một site cụ thể, và nó
 * thuộc phiên phụ trách site đó.
 *
 * ═══ TIỀN THẬT ═══
 *
 * Mỗi lô tối đa 1.000 chuỗi và tốn HAI task DataForSEO (volume + KD),
 * khoảng $0,025 mỗi lô. Script in chi phí ước tính TRƯỚC khi gọi và đòi
 * `--yes` nếu quá một lô — một vòng lặp lỡ tay trên vài nghìn chuỗi là tiền
 * thật, không phải một lần chạy hỏng.
 *
 * ═══ HAI ĐIỀU PHẢI BIẾT KHI ĐỌC KẾT QUẢ ═══
 *
 * 1. GOOGLE ADS GỘP BIẾN THỂ GẦN NHAU. Đo 24/9/2026 ở thị trường Việt Nam:
 *
 *        barcelona   550.000  kd=60        manchester city  550.000  kd=76
 *        barca       550.000  kd=34        man city         550.000  kd=59
 *
 *    Bằng nhau từng cặp. Nên VOLUME KHÔNG PHÂN BIỆT ĐƯỢC hai biến thể —
 *    chọn bằng volume ở đó là chọn bừa mà trông như có căn cứ. KD thì phân
 *    biệt được, vì nó tính từ SERP thật.
 *
 * 2. CHUỖI NGẮN MƠ HỒ MƯỢN VOLUME CỦA THỰC THỂ KHÁC:
 *
 *        "berlin"     8.100   thành phố, không phải CLB
 *        "hamburger" 33.100   món ăn, kd=0
 *        "barcelona" 14.800   khi hỏi cho RCD Espanyol — một CLB KHÁC HẲN
 *
 *    Mọi con số đều đúng; câu hỏi thì sai. Khử bớt bằng cách hỏi trong ngữ
 *    cảnh ("lịch thi đấu X"), nhưng ở thực thể nhỏ thì mọi số đều dưới 100
 *    và quá nhiễu để tự chọn.
 *
 * Chuỗi KHÔNG có dữ liệu bị BỎ, không điền 0: "không ai tìm" và "DataForSEO
 * không trả về" là hai chuyện khác nhau.
 */
import { readFileSync } from "node:fs";
import { measureKeywordsForVertical } from "@/lib/keywords/dataforseo-adapter";
import { marketFor, hasExplicitMarket } from "@/lib/keywords/markets";

const CHUNK = 1000;
const USD_PER_CHUNK = 0.025;

async function main() {
  const [vertical, file, ...rest] = process.argv.slice(2);
  if (!vertical || !file) {
    console.error("Dùng: npm run keywords:measure -- <vertical> <file.txt | ->");
    process.exit(1);
  }
  const raw = file === "-" ? readFileSync(0, "utf-8") : readFileSync(file, "utf-8");
  const keywords = [...new Set(
    raw.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  )];
  if (keywords.length === 0) {
    console.error("Không có từ khoá nào trong đầu vào.");
    process.exit(1);
  }

  const m = marketFor(vertical);
  const chunks = Math.ceil(keywords.length / CHUNK);
  console.log(`  nghề      ${vertical}${hasExplicitMarket(vertical) ? "" : "  (chưa khai thị trường riêng — rơi về Hoa Kỳ/en)"}`);
  console.log(`  thị trường location_code=${m.locationCode} language_code=${m.languageCode}`);
  console.log(`  từ khoá   ${keywords.length} chuỗi, ${chunks} lô`);
  console.log(`  chi phí   ước tính $${(chunks * USD_PER_CHUNK).toFixed(3)}`);

  if (chunks > 1 && !rest.includes("--yes")) {
    console.error(`\n✗ Hơn một lô. Thêm --yes nếu thật sự muốn chi $${(chunks * USD_PER_CHUNK).toFixed(3)}.`);
    process.exit(1);
  }

  const rows = await measureKeywordsForVertical(keywords, vertical);
  console.log(`\n  ${rows.length}/${keywords.length} chuỗi CÓ dữ liệu\n`);
  console.log("  volume\tKD\ttừ khoá");
  for (const r of rows) console.log(`  ${r.searchVolume}\t${r.keywordDifficulty ?? ""}\t${r.keyword}`);

  const missing = keywords.filter((k) => !rows.some((r) => r.keyword === k));
  if (missing.length > 0) {
    console.log(`\n  ${missing.length} chuỗi KHÔNG có dữ liệu (khác hẳn "volume 0"):`);
    for (const k of missing.slice(0, 20)) console.log(`    ${k}`);
    if (missing.length > 20) console.log(`    … và ${missing.length - 20} chuỗi nữa`);
  }
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
