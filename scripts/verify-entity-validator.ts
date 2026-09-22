/**
 * Cổng canh validator của trục thực thể.
 *
 *     npm run verify:entity-validator
 *
 * Thuần: không mạng, không database. Nên đây là cổng DUY NHẤT của nhóm này
 * chạy được trong CI, và nó nên ở đó.
 *
 * ═══ CA ĐẦU TIÊN LÀ MỘT LỖI ĐÃ XẢY RA THẬT ═══
 *
 * `extractNumbers` của validator địa lý đọc "," là dấu phân nhóm nghìn. Tiếng
 * Việt dùng "," làm dấu thập phân, nên "52,0%" ra 520 — lệch đúng 10 lần. Đo
 * 22/9/2026 trước khi có `extractNumbersVi`.
 *
 * Hậu quả nếu lọt: mọi phần trăm model trích ĐÚNG đều bị từ chối là "số không
 * có trong fact", nên mỗi trang có tỷ lệ trượt cả hai lượt thử rồi không có
 * văn nào. Ca này ở lại đây vĩnh viễn để một lần "dọn dẹp cho dùng chung
 * hàm" không lặng lẽ mang nó về.
 */
import { extractNumbersVi, validateEntityText } from "@/lib/ai/entity-validate";
import type { FootballFact } from "@/lib/football/facts";

let failures = 0;
const fail = (msg: string) => {
  console.error(`  ✗ ${msg}`);
  failures++;
};

const FACTS: FootballFact[] = [
  { key: "team_points", label: "điểm của Arsenal FC", value: 12, display: "12", unit: "điểm", scope: "TEAM", scopeName: "Arsenal FC" },
  { key: "team_played", label: "số trận Arsenal FC đã đá", value: 4, display: "4", unit: "trận", scope: "TEAM", scopeName: "Arsenal FC" },
  { key: "team_goals_for", label: "số bàn Arsenal FC ghi", value: 9, display: "9", unit: "bàn", scope: "TEAM", scopeName: "Arsenal FC" },
  { key: "league_over25_pct", label: "tỷ lệ trận trên 2,5 bàn ở Ngoại hạng Anh", value: 52, display: "52,0%", unit: "%", scope: "LEAGUE", scopeName: "Ngoại hạng Anh" },
  { key: "league_played", label: "số trận đã đá ở Ngoại hạng Anh", value: 50, display: "50", unit: "trận", scope: "LEAGUE", scopeName: "Ngoại hạng Anh" },
];

function expectNumbers(text: string, want: number[]): void {
  const got = extractNumbersVi(text).map((n) => n.value);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`đọc số từ ${JSON.stringify(text)}: được ${JSON.stringify(got)}, cần ${JSON.stringify(want)}`);
  }
}

function expectVerdict(label: string, text: string, shouldPass: boolean, rule?: string, pageAxis?: string): void {
  const r = validateEntityText(text, FACTS, { pageAxis });
  if (r.passed !== shouldPass) {
    fail(
      `${label}: ${r.passed ? "cho qua" : "từ chối"} trong khi cần ${shouldPass ? "cho qua" : "từ chối"}` +
        (r.issues.length ? ` — ${r.issues.map((i) => i.rule).join(", ")}` : "")
    );
    return;
  }
  if (rule && !r.issues.some((i) => i.rule === rule)) {
    fail(`${label}: từ chối đúng nhưng không vì luật "${rule}" (${r.issues.map((i) => i.rule).join(", ")})`);
  }
}

console.log("── Đọc số theo quy ước tiếng Việt ────────────────────────────");
expectNumbers("52,0%", [52]);
expectNumbers("8,5%", [8.5]);
expectNumbers("1.234 trận", [1234]);
expectNumbers("1.234,5", [1234.5]);
expectNumbers("Arsenal có 12 điểm sau 4 trận", [12, 4]);
// Mùa giải là MỘT token. Không che thì ra 2026 và -27, và mọi câu nhắc tên
// mùa bị từ chối — xem extractNumbersVi.
expectNumbers("mùa 2026-27", [2026]);
expectNumbers("mùa 2026-27 có 50 trận", [2026, 50]);

console.log("── Luật ──────────────────────────────────────────────────────");
expectVerdict(
  "văn đúng, nêu tên giải khi dùng số cấp giải",
  "Arsenal FC có 12 điểm sau 4 trận và đã ghi 9 bàn. Ở Ngoại hạng Anh, 52,0% số trận có trên 2,5 bàn.",
  true
);
expectVerdict(
  "ngưỡng 2,5 nằm trong nhãn chỉ số, cùng câu với chữ của nhãn",
  "Ở Ngoại hạng Anh, 52,0% số trận có trên 2,5 bàn.",
  true
);
expectVerdict(
  "mùa giải là năm dương lịch, không phải phép đo",
  "Arsenal FC có 12 điểm sau 4 trận trong mùa 2026-27.",
  true
);
expectVerdict(
  "ngưỡng dùng lại ở câu KHÔNG có chữ nào của nhãn",
  "Arsenal FC có 12 điểm sau 4 trận. Chỉ số 2,5 xuất hiện ở đây.",
  false,
  "unsupported_number"
);
expectVerdict(
  "số không có trong fact",
  "Arsenal FC có 12 điểm sau 4 trận và đã ghi 77 bàn.",
  false,
  "unsupported_number"
);
expectVerdict(
  "số cấp giải không nêu tên giải",
  "Arsenal FC có 12 điểm sau 4 trận. Có 52,0% số trận có trên 2,5 bàn.",
  false,
  "scope_overclaim"
);
expectVerdict(
  "nói về thứ không nguồn nào đo",
  "Arsenal FC có 12 điểm sau 4 trận, với 9 bàn đến từ các pha kiến tạo.",
  false,
  "unsupported_claim"
);
expectVerdict(
  "giọng cá cược",
  "Arsenal FC có 12 điểm sau 4 trận, cửa trên rất rõ ràng.",
  false,
  "betting_or_prediction"
);
expectVerdict(
  "tỷ lệ viết bằng chữ",
  "Arsenal FC có 12 điểm sau 4 trận, một nửa số đó đến trên sân nhà.",
  false,
  "worded_proportion"
);

// Hai ca dưới đây là hai lỗi ĐÃ XẢY RA khi sinh lô 22/9/2026, cả hai đều là
// validator báo sai trên văn đúng.
expectVerdict(
  "trang GIẢI không phải nêu tên giải ở từng câu",
  "Ngoại hạng Anh đã đá 50 trận. Trong số đó, tỷ lệ trận trên 2,5 bàn là 52,0%.",
  true,
  undefined,
  "league"
);
expectVerdict(
  "trang ĐỘI thì vẫn phải nêu",
  "Arsenal FC có 12 điểm sau 4 trận. Có 52,0% số trận có trên 2,5 bàn.",
  false,
  "scope_overclaim",
  "team"
);
expectVerdict(
  "chữ số nằm trong TÊN RIÊNG không phải phép đo",
  "Arsenal FC có 12 điểm sau 4 trận tại Ngoại hạng Anh.",
  true
);
// "Ligue 1" có chữ số trong TÊN. Trên trang đội, fact cấp giải đã bị lọc nên
// tên giải không còn ở scopeName nào — phải truyền riêng. Hai trang Pháp trượt
// đúng vì chỗ này.
{
  const r = validateEntityText("Paris FC có 12 điểm sau 4 trận tại Ligue 1.", FACTS, {
    pageAxis: "team",
    leagueName: "Ligue 1",
  });
  if (!r.passed) fail(`tên giải có chữ số: từ chối — ${r.issues.map((i) => i.rule).join(", ")}`);
}

console.log("");
if (failures > 0) {
  console.error(`ĐỎ — ${failures} vấn đề.`);
  process.exit(1);
}
console.log("XANH — validator trục thực thể đúng trên mọi ca.");
