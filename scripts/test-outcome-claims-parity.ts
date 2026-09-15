// Buộc hai chỗ cấm KẾT QUẢ phải nói cùng một điều.
//
// Tập cấm này sống ở HAI nơi, cố ý:
//   lib/ai/generate.ts      VERTICAL_BRIEFS.offLimits  → chặn TRƯỚC khi sinh
//   lib/content-rules       luật no-outcome-claims     → hợp đồng với site
//
// Hai bản sao của một quy tắc thì trôi lệch, và khi lệch thì chỗ LỎNG HƠN
// thắng: prompt không cấm thì model viết, registry không cấm thì site
// không chặn. File này biến "tôi sẽ viết cùng lúc" thành một điều kiện
// kiểm được, thay vì một lời hứa trong commit message.
//
// Không gọi API, không chạm DB.

import { systemPromptFor } from "../lib/ai/generate";
import { buildContentRules } from "../lib/content-rules/registry";

/**
 * Từ khoá của tập cấm. Mỗi từ phải xuất hiện ở CẢ hai nơi.
 *
 * Danh sách này là bản thứ BA, nên nó phải nhỏ và chỉ chứa khái niệm cốt
 * lõi — không chép cả câu. Thêm một khái niệm mới vào một chỗ mà quên chỗ
 * kia thì test đỏ; thêm vào cả hai thì thêm vào đây.
 */
const BANNED_CONCEPTS = [
  { en: "settlement", vi: "bồi thường" },
  { en: "verdict", vi: "bản án" },
  { en: "success", vi: "thắng" },
  { en: "how long", vi: "thời gian giải quyết" },
  { en: "worth", vi: "xác suất" },
];

let pass = 0;
const fails: string[] = [];
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fails.push(`${name}\n      ${e instanceof Error ? e.message : e}`); console.log(`✗ ${name}`); }
}

async function main() {
  const prompt = systemPromptFor("auto-accident-attorney", null).toLowerCase();
  const rules = await buildContentRules();
  const rule = (rules.declaredRules ?? []).find((r) => r.id === "no-outcome-claims");

  check("luật no-outcome-claims tồn tại trong registry", () => {
    if (!rule) throw new Error("không tìm thấy — site sẽ không biết luật này tồn tại");
  });

  check("prompt cho AAA dựng được (brief tồn tại)", () => {
    // systemPromptFor NÉM khi thiếu brief. Nếu ai gỡ brief đi, cả lớp AI
    // dừng — đó là hành vi đúng, và test này nói ra nó đã dừng.
    if (prompt.length < 100) throw new Error("prompt quá ngắn, brief có thể đã mất");
  });

  for (const c of BANNED_CONCEPTS) {
    check(`"${c.en}" bị cấm ở CẢ prompt lẫn registry`, () => {
      const inPrompt = prompt.includes(c.en);
      const inRule = rule ? rule.rule.toLowerCase().includes(c.vi) : false;
      if (inPrompt && inRule) return;
      throw new Error(
        `prompt: ${inPrompt ? "có" : "THIẾU"} | registry: ${inRule ? "có" : "THIẾU"} — ` +
          `một chỗ cấm mà chỗ kia không cấm, và chỗ lỏng hơn sẽ thắng`
      );
    });
  }

  check("luật nói rõ vì sao ba luật cũ KHÔNG bắt được nhóm này", () => {
    // Không có đoạn này thì người đọc sẽ hỏi "đã có no-price-claims rồi mà"
    // và gỡ luật mới đi như một bản trùng.
    const t = rule?.rule ?? "";
    for (const other of ["no-supply-side-bridge", "no-price-claims", "stay-in-trade"]) {
      if (!t.includes(other)) throw new Error(`không nhắc ${other} — luật này trông như bản trùng của nó`);
    }
  });

  check("luật KHÔNG chỉ dành cho nghề luật", () => {
    // Viết riêng cho một ngành là mời ngành khác lặp lại cùng lỗi dưới tên
    // khác — "tiết kiệm được bao nhiêu" trên trang điện mặt trời là cùng
    // một hình dạng.
    if (!(rule?.rule ?? "").includes("mọi ngành")) throw new Error("không nêu phạm vi toàn bộ ngành");
  });

  check("trạng thái chứng minh nói THẬT là chưa có vector", () => {
    // "chưa chứng minh" và "đã chứng minh" là hai trạng thái khác nhau. Để
    // trống provenBy sẽ khiến luật này trông ngang hàng với 11 luật kia.
    if (!(rule?.provenBy ?? "").toLowerCase().includes("chưa")) {
      throw new Error("provenBy không nói rõ luật này chưa có vector conformance nào");
    }
  });

  console.log(`\n${pass}/${pass + fails.length} đúng.`);
  if (fails.length > 0) { console.error(`\nTRƯỢT:\n  ${fails.join("\n  ")}`); process.exitCode = 1; }
}
main();
