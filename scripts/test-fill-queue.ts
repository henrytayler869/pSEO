import { rankCandidates, summarize, judgeFillBudget, COST_PER_PASSAGE_USD, type FillCandidate } from "@/lib/ai/fill-queue";

let pass = 0;
const fail: string[] = [];
function check(n: string, ok: boolean, d = "") {
  if (ok) pass++;
  else fail.push(`${n}${d ? ` — ${d}` : ""}`);
}

const c = (zip: string, sv: number | null, served = false, stale = false): FillCandidate => ({
  zip, city: "X", state: "CA", mainKeyword: "movers x", searchVolume: sv, served, stale,
});

// ---- xếp hạng ----
const ranked = rankCandidates([c("10001", 100), c("10002", 5000), c("10003", 900)]);
check("lượng tìm kiếm cao lên trước", ranked.map((r) => r.zip).join(",") === "10002,10003,10001", ranked.map(r=>r.zip).join(","));
check("rank bắt đầu từ 1", ranked[0].rank === 1);
check("mỗi mục có lý do xếp hạng", ranked.every((r) => r.why.length > 5));

check("ZIP ĐÃ phục vụ không vào hàng đợi", rankCandidates([c("1", 9999, true), c("2", 1)]).length === 1);
check("hàng đợi rỗng khi mọi thứ đã phục vụ", rankCandidates([c("1", 9, true)]).length === 0);

const withNull = rankCandidates([c("1", null), c("2", 10), c("3", null)]);
check("ZIP CHƯA ĐO từ khoá xuống cuối, KHÔNG bị loại", withNull.length === 3 && withNull[0].zip === "2",
  "thiếu số đo nghĩa là chưa ai đo, không phải không có nhu cầu");
check("lý do nói rõ chưa đo", withNull[2].why.includes("chưa đo"));

check("ZIP mất chữ được nêu rõ trong lý do",
  rankCandidates([c("1", 500, false, true)])[0].why.includes("chữ không tới nơi"));

check("thứ tự ổn định khi cùng lượng tìm kiếm",
  rankCandidates([c("30", 5), c("10", 5), c("20", 5)]).map((r) => r.zip).join(",") === "10,20,30");

// ---- tổng hợp ----
const s = summarize([c("1", 1, true), c("2", 1, false, true), c("3", 1), c("4", 1)]);
check("đếm đúng ba trạng thái", s.served === 1 && s.stale === 1 && s.never === 2, JSON.stringify(s));
check("ước phí chỉ tính phần CHƯA phục vụ", Math.abs(s.estimatedUsd - 3 * COST_PER_PASSAGE_USD) < 1e-9);
check("ước phí dùng p90 chứ không phải trung bình", COST_PER_PASSAGE_USD > 0.0191,
  "ước thấp khiến người bấm biết mình vượt ngân sách SAU khi đã tiêu");

// ---- ngân sách ----
check("trong ngân sách → cho", judgeFillBudget({ budgetUsd: 25, spentUsd: 11.66, estimatedUsd: 2 }).ok);
const over = judgeFillBudget({ budgetUsd: 25, spentUsd: 24, estimatedUsd: 2 });
check("vượt ngân sách → CẢNH BÁO", !over.ok);
check("lý do nêu đủ ba con số", !over.ok && ["2.00", "24.00", "26.00", "25.00"].every((x) => over.reason.includes(x)), !over.ok ? over.reason : "");
const noBudget = judgeFillBudget({ budgetUsd: null, spentUsd: 0, estimatedUsd: 1 });
check("CHƯA ĐẶT ngân sách KHÔNG phải không giới hạn", !noBudget.ok,
  "null là 'chưa ai quyết', và câu trả lời đúng là nói ra chứ không lặng lẽ cho qua");
check("đúng bằng ngân sách vẫn cho", judgeFillBudget({ budgetUsd: 10, spentUsd: 8, estimatedUsd: 2 }).ok);

console.log(fail.length ? `\n✗ ${fail.length} trượt:\n  ${fail.join("\n  ")}\n` : "");
console.log(`${pass}/${pass + fail.length} đạt.`);
process.exit(fail.length ? 1 : 0);
