// Kiểm judgeBudget — phần quyết định của ngân sách AI theo publisher.
//
// Ca quan trọng nhất là "chưa đặt ngân sách": nếu nó rơi vào cùng nhánh với
// "trong ngân sách" thì giao diện hiện màu xanh cho một ngân sách không tồn
// tại — trả lời sai đúng câu người ta đang hỏi.

import { judgeBudget, formatBudgetPercent } from "../lib/ai/budget";

let pass = 0;
const fails: string[] = [];
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fails.push(`${name}\n      ${e instanceof Error ? e.message : e}`); console.log(`✗ ${name}`); }
}
function eq(a: unknown, b: unknown, what: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: nhận ${JSON.stringify(a)}, cần ${JSON.stringify(b)}`);
}
const base = { ownUsd: 0, sharedUsd: 0, sharedWithSites: 1 };

check("chưa đặt ngân sách → 'no-budget', KHÔNG phải 'under'", () => {
  const s = judgeBudget({ ...base, budgetUsd: null, sharedUsd: 7.4 });
  eq(s.verdict, "no-budget", "verdict");
  eq(s.percent, null, "percent");
});

check("dưới ngân sách → 'under'", () => {
  eq(judgeBudget({ ...base, budgetUsd: 10, sharedUsd: 7.4 }).verdict, "under", "verdict");
});

check("vượt ngân sách → 'over' kèm số tiền vượt", () => {
  const s = judgeBudget({ ...base, budgetUsd: 5, sharedUsd: 7.4 });
  eq(s.verdict, "over", "verdict");
  eq(Number(s.overUsd.toFixed(4)), 2.4, "overUsd");
});

check("đúng bằng ngân sách → 'under', không phải 'over'", () => {
  // Ranh giới. "Vượt" phải nghĩa là vượt thật, không phải chạm.
  eq(judgeBudget({ ...base, budgetUsd: 7.4, sharedUsd: 7.4 }).verdict, "under", "verdict");
});

check("ngân sách 0 KHÁC chưa đặt ngân sách", () => {
  // `0 || null` cho null và sẽ nuốt mất lựa chọn "niche này không tiêu nữa".
  const s = judgeBudget({ ...base, budgetUsd: 0, sharedUsd: 0.01 });
  eq(s.verdict, "over", "verdict");
  eq(s.budgetUsd, 0, "budgetUsd");
});

check("ngân sách 0 và chưa tiêu gì → 'under', percent hữu hạn", () => {
  const s = judgeBudget({ ...base, budgetUsd: 0, sharedUsd: 0 });
  eq(s.verdict, "under", "verdict");
  eq(Number.isFinite(s.percent!), true, "percent hữu hạn (không Infinity/NaN)");
});

check("cộng cả phần riêng lẫn phần dùng chung", () => {
  const s = judgeBudget({ ownUsd: 2, sharedUsd: 3, sharedWithSites: 1, budgetUsd: 10 });
  eq(s.totalUsd, 5, "totalUsd");
});

check("nhiều publisher cùng niche → giữ số để giao diện nói rõ là dùng chung", () => {
  // Không chia đôi sharedUsd: chia là bịa ra độ chính xác không có thật.
  const s = judgeBudget({ ownUsd: 0, sharedUsd: 7.4, sharedWithSites: 3, budgetUsd: 10 });
  eq(s.sharedWithSites, 3, "sharedWithSites");
  eq(s.totalUsd, 7.4, "totalUsd");
});

check("percent tính trên TỔNG, không chỉ phần riêng", () => {
  const s = judgeBudget({ ownUsd: 5, sharedUsd: 5, sharedWithSites: 1, budgetUsd: 20 });
  eq(s.percent, 50, "percent");
});

check("tiêu ít nhưng CÓ tiêu → '<1%', không phải '0%'", () => {
  // 0,065/20 = 0,33%. toFixed(0) cho "0%" và đọc ra là đường ống chưa chạy.
  eq(formatBudgetPercent(0.326), "<1%", "percent");
});

check("chưa tiêu gì → '0%'", () => {
  eq(formatBudgetPercent(0), "0%", "percent");
});

check("chưa đặt ngân sách → không có chữ tỷ lệ nào", () => {
  eq(formatBudgetPercent(null), null, "percent");
});

console.log(`\n${pass}/${pass + fails.length} đúng.`);
if (fails.length > 0) { console.error(`\nTRƯỢT:\n  ${fails.join("\n  ")}`); process.exitCode = 1; }
