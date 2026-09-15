import { buildContentRules } from "@/lib/content-rules/registry";
import { VERTICALS_WITH_BRIEFS, systemPromptFor } from "@/lib/ai/generate";

/**
 * Chạy: node_modules/.bin/tsx scripts/test-fars-scope-parity.ts
 *
 * Cùng khuôn với test-outcome-claims-parity.ts, cho một luật khác.
 *
 * Ràng buộc phạm vi FARS sống ở HAI nơi và chúng phục vụ hai việc khác nhau:
 * brief là PHÒNG NGỪA (mô hình thấy nó lúc viết), luật trong registry là
 * HỢP ĐỒNG (publisher thấy nó lúc kiểm trang đã render). Sửa một nơi mà
 * quên nơi kia thì hoặc mô hình được dặn một đằng còn site kiểm một nẻo,
 * hoặc tệ hơn: site kiểm một luật không còn ai dặn.
 *
 * Không có phép kiểm này thì hai bản văn sẽ trôi lệch, và không gì báo.
 */

const FORBIDDEN_WITHOUT_FATAL = ["accident", "collision", "crash", "wreck", "incident"];

let pass = 0;
const fail: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const rules = await buildContentRules();
  const rule = rules.declaredRules.find((r) => r.id === "fatal-crash-scope");
  check("registry có luật fatal-crash-scope", !!rule);
  if (!rule) {
    console.log(`\n✗ ${fail.join("\n  ")}`);
    process.exit(1);
  }

  const prompt = systemPromptFor("auto-accident-attorney", null);
  check("có brief cho auto-accident-attorney", VERTICALS_WITH_BRIEFS.includes("auto-accident-attorney"));

  // 1. Cả hai nơi phải nói rằng FARS chỉ đếm vụ có người chết.
  check("luật nêu FARS chỉ ghi vụ có người chết", /FARS/.test(rule.rule) && /CH[ỈI]\s*ghi|ch[ỉi] ghi/i.test(rule.rule));
  check(
    "prompt nêu FARS chỉ ghi vụ có người chết",
    /FARS/.test(prompt) && /only crashes in which someone died/i.test(prompt),
    "mô hình không đọc registry — nếu prompt không nói thì prompt không biết"
  );

  // 2. Mỗi từ nguy hiểm phải được gọi tên ở CẢ HAI nơi. Liệt kê ở một nơi
  //    thôi là chỗ thứ hai sẽ bỏ sót đúng từ đó.
  for (const w of FORBIDDEN_WITHOUT_FATAL) {
    check(`luật gọi tên "${w}"`, rule.rule.toLowerCase().includes(w));
    check(`prompt gọi tên "${w}"`, prompt.toLowerCase().includes(w));
  }

  // 3. Cả hai nơi phải nói hai chỉ số KHÔNG thay thế cho nhau.
  check("luật nói vụ ≠ người", /đếm V[ỤU]|VỤ có người chết/.test(rule.rule) && /NGƯỜI chết/.test(rule.rule));
  check(
    "prompt nói vụ ≠ người",
    /counts CRASHES/i.test(prompt) && /counts PEOPLE/i.test(prompt),
    "đây là nhầm lẫn khó thấy nhất: cả hai đều là số nguyên hợp lý cho cùng một nơi"
  );

  // 4. Luật phải nêu nó KHÁC luật nào — đây là chỗ mọi luật trước trong
  //    registry đều buộc phải nói, vì luật không phân biệt được với luật
  //    khác là luật sẽ bị người đọc gộp vào luật kia rồi bỏ qua.
  check("luật nói rõ khác scope-disclosure", /scope-disclosure/.test(rule.rule));
  check("luật nói rõ khác no-outcome-claims", /no-outcome-claims/.test(rule.rule));

  // 5. Con số dẫn chứng phải là con số ĐO ĐƯỢC, và phải trùng nhau giữa
  //    rule và provenBy — hai chỗ chép tay là hai chỗ trôi lệch.
  for (const n of ["72.207", "110.401"]) {
    check(`luật dẫn con số đo được ${n}`, rule.rule.includes(n));
  }
  check("provenBy nói rõ chưa có vector conformance", /Ch[ưu]a publisher n[àa]o/.test(rule.provenBy ?? ""));

  console.log(fail.length ? `\n✗ ${fail.length} trượt:\n  ${fail.join("\n  ")}\n` : "");
  console.log(`${pass}/${pass + fail.length} đạt.`);
  process.exit(fail.length ? 1 : 0);
}

void main();
