// Đo phép thử: nhóm đã gửi dịch vụ index có nhanh hơn nhóm đối chứng không?
//
// Câu trả lời đến từ URL Inspection của GOOGLE, không từ dịch vụ. API của
// Omega chỉ trả "done" — không trạng thái, không campaign id — nên hỏi họ
// cũng chỉ nhận lại lời hứa của chính họ. Google là bên duy nhất biết trang
// đã vào chỉ mục hay chưa.
//
// Dùng: tsx scripts/index-experiment.ts

import { prisma } from "../lib/db/prisma";
import { resolveSite, reportSiteError } from "../lib/scripts/resolve-site";
import { fetchUrlIndexStatus } from "../lib/google/search-console";

function pct(a: number, b: number): string {
  return b === 0 ? "—" : `${((a / b) * 100).toFixed(0)}%`;
}

async function main() {
  let site: { id: string; url: string; vertical: string; gscPropertyUrl: string };
  try {
    site = await resolveSite<{ id: string; url: string; vertical: string; gscPropertyUrl: string }>({ select: { gscPropertyUrl: true } });
  } catch (err) {
    if (reportSiteError(err)) return;
    throw err;
  }

  const rows = await prisma.indexSubmission.findMany({
    where: { websiteId: site.id },
    orderBy: { submittedAt: "asc" },
  });
  if (rows.length === 0) { console.log("Chưa có phép thử nào. Chạy: tsx scripts/omega-submit.ts"); return; }

  const started = rows[0].submittedAt;
  const days = (Date.now() - started.getTime()) / 86_400_000;
  console.log(`Phép thử bắt đầu ${started.toISOString().slice(0, 10)} — đã ${days.toFixed(1)} ngày\n`);

  const arms = new Map<string, { total: number; wasIndexed: number; nowIndexed: number; unknown: number }>();
  for (const r of rows) {
    const e = arms.get(r.arm) ?? { total: 0, wasIndexed: 0, nowIndexed: 0, unknown: 0 };
    e.total++;
    if (r.indexedAtSubmit === true) e.wasIndexed++;
    let now: boolean | null;
    try {
      now = await fetchUrlIndexStatus(site.gscPropertyUrl, r.url);
    } catch {
      now = null;
    }
    if (now === null) e.unknown++;
    else if (now) e.nowIndexed++;
    arms.set(r.arm, e);
  }

  console.log("nhóm".padEnd(12) + "n".padStart(4) + "index lúc gửi".padStart(16) + "index bây giờ".padStart(16) + "  mới vào chỉ mục");
  const newly = new Map<string, number>();
  for (const [arm, e] of arms) {
    const gained = e.nowIndexed - e.wasIndexed;
    newly.set(arm, gained);
    console.log(
      arm.padEnd(12) +
        String(e.total).padStart(4) +
        `${e.wasIndexed} (${pct(e.wasIndexed, e.total)})`.padStart(16) +
        `${e.nowIndexed} (${pct(e.nowIndexed, e.total)})`.padStart(16) +
        `  +${gained}${e.unknown > 0 ? `  (${e.unknown} không đo được)` : ""}`
    );
  }

  const s = arms.get("submitted");
  const c = arms.get("control");
  console.log();
  if (!s || !c) { console.log("Thiếu một trong hai nhóm — chưa kết luận được."); }
  else if (days < 3) {
    console.log(`Mới ${days.toFixed(1)} ngày. Họ hứa 24 giờ, nhưng Google index theo nhịp của Google — đợi ít nhất 3 ngày rồi hãy đọc.`);
  } else {
    const gs = (newly.get("submitted") ?? 0) / Math.max(1, s.total - s.wasIndexed);
    const gc = (newly.get("control") ?? 0) / Math.max(1, c.total - c.wasIndexed);
    console.log(`tỷ lệ trang chưa index nay đã index — gửi ${pct(newly.get("submitted") ?? 0, s.total - s.wasIndexed)} vs đối chứng ${pct(newly.get("control") ?? 0, c.total - c.wasIndexed)}`);
    // Cỡ mẫu vài chục URL thì chênh lệch nhỏ là nhiễu. Nói ra ngưỡng thay vì
    // để người đọc tự thấy một con số lớn hơn và kết luận.
    if (s.total < 10 || c.total < 10) console.log("⚠ Mỗi nhóm dưới 10 URL — chênh lệch ở cỡ này chưa phân biệt được với nhiễu.");
    else if (gs > gc * 2) console.log("=> Nhóm gửi vào chỉ mục nhanh hơn RÕ RỆT. Dịch vụ có tác dụng đo được.");
    else if (gs > gc) console.log("=> Nhóm gửi nhỉnh hơn, nhưng chưa gấp đôi. Chưa đủ để kết luận ở cỡ mẫu này.");
    else console.log("=> KHÔNG có chênh lệch có lợi cho nhóm gửi. Thứ thay đổi là thời gian, không phải dịch vụ.");
  }
  await prisma.$disconnect();
}
main();
