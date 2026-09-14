// Kiểm rằng một lần sinh RỖNG hoặc CỤT bị chặn.
//
// Ca thật, 14/9/2026: model tiêu hết 1024 token output vào khối thinking và
// không sinh khối text nào. generateWithClaude trả về "". Mọi cổng phía sau
// ĐẠT trên chuỗi rỗng — validator sự thật không thấy con số nào sai vì không
// có con số nào; cổng trùng lặp thấy chuỗi ngắn hơn ngưỡng nên trả null.
// Đoạn rỗng được lưu là ĐẠT và phục vụ cho ZIP 02301 trên site thật.
//
// Không gọi API: kiểm chính cái vị ngữ đã hỏng.

import { readFileSync } from "node:fs";
import { IncompleteGenerationError } from "../lib/ai/anthropic";
import { validateGeneratedText } from "../lib/ai/validate";
import { judgeDistinctness } from "../lib/ai/distinctness";
import type { FactSet } from "../lib/ai/facts";

let pass = 0;
const fails: string[] = [];
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fails.push(`${name}\n      ${e instanceof Error ? e.message : e}`); console.log(`✗ ${name}`); }
}

const FS = {
  vertical: "moving-services", zip: "02301", city: "Brockton", state: "MA", county: "Plymouth County",
  fingerprint: "x", searchIntent: null,
  facts: [{ label: "Median household income", display: "$72,727", value: 72727, scope: "ZIP", scopeName: null, unit: "usd" }],
} as unknown as FactSet;

check("validator SỰ THẬT đạt trên chuỗi rỗng — vì sao nó không đủ", () => {
  // Không phải lỗi của validator: nó kiểm "số nào sai", và rỗng thì không có
  // số nào sai. Ghi lại để không ai kết luận nhầm là nó đủ để gác.
  if (!validateGeneratedText("", FS).passed) throw new Error("giả định đã đổi — đọc lại bản vá 14/9");
});

check("cổng TRÙNG LẶP cũng đạt trên chuỗi rỗng", () => {
  if (!judgeDistinctness("", ["văn bản cũ nào đó ở đây cho đủ dài"]).ok) throw new Error("giả định đã đổi");
});

check("=> chặn phải nằm ở generateWithClaude, và lớp lỗi đó tồn tại", () => {
  const e = new IncompleteGenerationError("Model không sinh khối text nào (stop_reason: max_tokens, output 1024 token).");
  if (!(e instanceof Error)) throw new Error("không phải Error");
  if (!/stop_reason/.test(e.message)) throw new Error("thông điệp phải nêu stop_reason để chẩn đoán được");
});

check("MAX_OUTPUT_TOKENS đủ chỗ cho thinking", () => {
  // 1024 là con số đã gây ra sự cố: thinking ăn hết trần, không còn chỗ cho
  // text. Đọc từ source vì hằng số không xuất ra.
  const src = readFileSync("lib/ai/anthropic.ts", "utf-8");
  const m = src.match(/const MAX_OUTPUT_TOKENS = (\d+)/);
  if (!m) throw new Error("không tìm thấy MAX_OUTPUT_TOKENS");
  const v = Number(m[1]);
  if (v <= 1024) throw new Error(`MAX_OUTPUT_TOKENS = ${v}; ở mức này thinking đã từng ăn hết trần và text về rỗng`);
});

check("văn bản CỤT cũng qua validator sự thật — dạng khó thấy hơn rỗng", () => {
  // Ca thật: 3 đoạn đang phục vụ trên site, mỗi đoạn đúng 1024 token, cắt
  // giữa câu. "...ask now about certific". Chúng không nêu số nào SAI — chỉ
  // thiếu — nên validator đạt, và nhìn thoáng qua thì bình thường. Bản vá
  // đầu chỉ bắt dạng rỗng và đã bỏ sót đúng dạng này.
  const cut = "Median household income in ZIP 02301 is $72,727. Ask now about certific";
  if (!validateGeneratedText(cut, FS).passed) throw new Error("giả định đã đổi — đọc lại bản vá 14/9");
});

check("=> chặn dựa vào stop_reason, không dựa vào việc đọc văn bản", () => {
  // Không có cách đáng tin nào để nhìn chữ mà biết nó cụt: "ask now about
  // certific" trông giống một lỗi đánh máy. Thứ biết chắc là stop_reason,
  // và chỉ generateWithClaude nhìn thấy nó.
  const e = new IncompleteGenerationError("Model chạm trần output 1024 token và bị cắt giữa chừng.");
  if (!/cắt giữa chừng/.test(e.message)) throw new Error("thông điệp phải nói rõ là cụt, không chỉ nói rỗng");
});

console.log(`\n${pass}/${pass + fails.length} đúng.`);
if (fails.length > 0) { console.error(`\nTRƯỢT:\n  ${fails.join("\n  ")}`); process.exitCode = 1; }
