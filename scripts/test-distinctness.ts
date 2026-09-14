// Kiểm judgeDistinctness — cổng chặn văn sinh lại trùng với văn đã publish.
//
// Ca đầu tiên là ca thật: mạch 47 từ đo được khi sinh lại ZIP 95020 với
// cùng prompt. Nếu cổng này không bắt được nó thì cả tính năng sinh lại chỉ
// là một nút bấm tốn tiền.

import { judgeDistinctness, avoidBlock, MAX_SHARED_RUN_WORDS } from "../lib/ai/distinctness";

let pass = 0;
const fails: string[] = [];
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fails.push(`${name}\n      ${e instanceof Error ? e.message : e}`); console.log(`✗ ${name}`); }
}
function eq(a: unknown, b: unknown, what: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: nhận ${JSON.stringify(a)}, cần ${JSON.stringify(b)}`);
}

const OLD = "In ZIP 95020, 9.51% of residents lived somewhere else a year earlier, and the recorded arrivals break down as 4,688 people from elsewhere in Santa Clara County, 1,147 from another county, 335 from abroad and 224 from another state. Those counts describe people arriving in this ZIP code; they say nothing about how many moving companies work here, what they charge or how far ahead they schedule, since none of that was measured.";

check("bắt được mạch 47 từ — ca thật đã đo", () => {
  const NEW = "In ZIP 95020, 9.51% of residents lived somewhere else a year earlier: 4,688 people came from elsewhere in Santa Clara County, 1,147 from another county, 335 from abroad and 224 from another state. Those counts describe people arriving in this ZIP code — they say nothing about how many moving companies work here, what they charge, or how far ahead they schedule.";
  const v = judgeDistinctness(NEW, [OLD]);
  eq(v.ok, false, "phải trượt");
  if (v.worstWords < 40) throw new Error(`mạch đo được chỉ ${v.worstWords} từ, đáng lẽ ~47`);
});

check("văn thật sự khác thì ĐẠT, không chặn bừa", () => {
  const NEW = "Roughly one in ten people here had a different address twelve months ago. Most of that movement stayed inside the county.";
  eq(judgeDistinctness(NEW, [OLD]).ok, true, "phải đạt");
});

check("mạch toàn số ở mức đo được (13 từ) vẫn ĐẠT", () => {
  // Ca 30024. Trần dưới 13 sẽ đánh trượt một đoạn hợp lệ, và một cổng
  // không ai qua nổi là cổng người ta tắt đi.
  const prior = "Homes are owner occupied at 78.5% with a median home value of $491,400 across the area.";
  const now = "Owner occupied at 78.5% with a median home value of $491,400, this ZIP sits above the state figure.";
  const v = judgeDistinctness(now, [prior]);
  eq(v.ok, true, "phải đạt");
  if (v.worstWords > MAX_SHARED_RUN_WORDS) throw new Error(`đo ${v.worstWords} từ, vượt trần ${MAX_SHARED_RUN_WORDS}`);
});

check("so với MỌI bản cũ, không chỉ bản mới nhất", () => {
  // Lần dựng lại thứ hai phải khác cả hai lần trước. Chỉ so bản gần nhất
  // thì văn bản dao động qua lại giữa hai cách viết và luôn "đạt".
  const sach = "Roughly one in ten people here had a different address twelve months ago.";
  const v = judgeDistinctness(OLD, [sach, OLD]);
  eq(v.ok, false, "phải trượt vì trùng bản thứ hai trong danh sách");
});

check("chưa có bản cũ nào → ĐẠT, không phải 'chưa kiểm được'", () => {
  const v = judgeDistinctness("Bất kỳ văn bản nào.", []);
  eq(v.ok, true, "phải đạt");
  eq(v.comparedWith, 0, "comparedWith");
  eq(v.worstPhrase, null, "worstPhrase");
});

check("báo số bản đã đối chiếu, để 'đạt' nói được nó dựa trên gì", () => {
  eq(judgeDistinctness("x y z", ["a b c", "d e f"]).comparedWith, 2, "comparedWith");
});

check("avoidBlock rỗng khi không có bản cũ — không nhồi chỉ dẫn vô nghĩa", () => {
  eq(avoidBlock([]), "", "avoidBlock");
});

check("avoidBlock đưa NGUYÊN VĂN bản cũ, không tóm tắt", () => {
  const b = avoidBlock([OLD]);
  if (!b.includes(OLD)) throw new Error("không chứa nguyên văn bản cũ");
  if (!b.includes(String(MAX_SHARED_RUN_WORDS))) throw new Error("không nêu ngưỡng cho model biết");
});

check("avoidBlock cấm đổi số — lệnh 'viết khác đi' trần trụi sẽ được thi hành bằng cách đổi số", () => {
  const b = avoidBlock([OLD]);
  if (!/must stay identical/i.test(b)) throw new Error("không nêu ràng buộc giữ nguyên con số");
});

check("chuỗi RỖNG lọt qua cổng trùng lặp — vì sao phải chặn ở tầng trên", () => {
  // Ghi lại sự thật khó chịu này thay vì giả vờ cổng bắt được: chuỗi rỗng
  // ngắn hơn MIN_RUN nên longestSharedPhrase trả null, và verdict là ĐẠT.
  // Ngày 14/9/2026 một đoạn rỗng đã đi qua cả cổng này lẫn validator sự
  // thật rồi được phục vụ trên site. Chỗ chặn đúng là generateWithClaude,
  // nơi biết model trả về gì — xem EmptyGenerationError.
  eq(judgeDistinctness("", [OLD]).ok, true, "cổng này KHÔNG bắt được rỗng");
});

console.log(`\n${pass}/${pass + fails.length} đúng.`);
if (fails.length > 0) { console.error(`\nTRƯỢT:\n  ${fails.join("\n  ")}`); process.exitCode = 1; }
