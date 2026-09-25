// Gửi URL chưa index tới Omega Indexer, GIỮ LẠI một nhóm đối chứng.
//
// Vì sao có nhóm đối chứng: một trang mới cuối cùng cũng được index dù có
// gửi hay không. "Gửi rồi thấy index" là quan sát tương thích với cả hai khả
// năng — dịch vụ có tác dụng, và thời gian trôi qua. Chỉ chênh lệch giữa hai
// nhóm mới phân biệt được, và nhóm đối chứng phải chọn TRƯỚC khi gửi.
//
// Ghép cặp theo THỨ HẠNG volume: URL thứ 1 gửi, thứ 2 đối chứng, thứ 3 gửi…
// Chia ngẫu nhiên có thể dồn hết trang lớn vào một nhóm, và khi đó chênh
// lệch đọc được là chênh lệch về độ quan trọng chứ không về dịch vụ.
//
// Dùng:
//   tsx scripts/omega-submit.ts --dry              # xem sẽ gửi gì, không gửi
//   tsx scripts/omega-submit.ts --limit 20 --drip 7
//   tsx scripts/omega-submit.ts --limit 131 --no-control   # gửi hết, không giữ đối chứng

import { prisma } from "../lib/db/prisma";
import { getGoogleAccessToken } from "../lib/google/service-account";
import { resolveSite, reportSiteError } from "../lib/scripts/resolve-site";
import { fetchServedInventory } from "../lib/publisher/inventory";
import { fetchSitemapCounts } from "../lib/sitemap/count";
import { fetchUrlIndexStatus } from "../lib/google/search-console";
import { submitToOmega } from "../lib/indexing/omega";

const PROVIDER = "omega-indexer";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}


/**
 * Trạng thái index hiện tại của từng URL, để chia hai nhánh cho cân.
 *
 * Hỏi Google chứ không suy từ sitemap: "có trong sitemap" nói ta đã nộp gì,
 * không nói Google nhận gì. Đo 14/9: 39/194 URL trong sitemap vẫn ở trạng
 * thái "unknown to Google".
 *
 * URL hỏi không được rơi vào tầng riêng "(không hỏi được)" thay vì bị đoán
 * là "chưa index": một sự cố quota không được phép âm thầm dồn URL về một
 * nhánh.
 */
async function fetchIndexStates(propertyUrl: string, urls: string[]): Promise<Map<string, string>> {
  const token = await getGoogleAccessToken(["https://www.googleapis.com/auth/webmasters.readonly"]);
  const out = new Map<string, string>();
  const CONCURRENCY = 4;
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    await Promise.all(
      urls.slice(i, i + CONCURRENCY).map(async (u) => {
        try {
          const res = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ inspectionUrl: u, siteUrl: propertyUrl }),
          });
          if (!res.ok) { out.set(u, "(không hỏi được)"); return; }
          const b = (await res.json()) as { inspectionResult?: { indexStatusResult?: { coverageState?: string } } };
          out.set(u, b.inspectionResult?.indexStatusResult?.coverageState ?? "(không rõ)");
        } catch {
          out.set(u, "(không hỏi được)");
        }
      })
    );
  }
  return out;
}

async function main() {
  const dry = process.argv.includes("--dry");

  // --no-control: GỬI HẾT, không giữ nhánh đối chứng.
  //
  // Mặc định chia đôi là đúng trong khi phép thử còn là câu hỏi mở. Nó đã
  // đóng: đo 24/9/2026 qua 7 mốc, nhánh gửi 10/10 index và KHÔNG URL nào rơi
  // ra, đối chứng đứng ở 1/10 từ 17/9, Fisher p = 1,19 × 10⁻⁴. Một nhánh đối
  // chứng THỨ HAI không trả lời thêm câu nào, còn giá của nó là số trang bị
  // cố tình bỏ ngoài index — 65 trang trong lô 131.
  //
  // PHÉP THỬ CŨ KHÔNG MẤT khi dùng cờ này, và đó là điều làm nó an toàn: 30
  // URL của phép thử nằm trong IndexSubmission, `already` phía dưới loại
  // chúng khỏi MỌI lô sau, nên 10 URL đối chứng gốc vĩnh viễn không được gửi
  // và pipeline IndexRecheckRun vẫn đo chúng mỗi 24 giờ. Ai xoá các hàng ấy
  // để "chạy lại cho sạch" thì cùng lúc xoá nhóm đối chứng duy nhất của dự án.
  //
  // KHÔNG được biến cờ này thành mặc định. Dịch vụ khác, site khác, nghề khác
  // đều là câu hỏi mở lần nữa, và ở đó chia đôi lại là việc đúng.
  const noControl = process.argv.includes("--no-control");

  const limit = Number(arg("limit", "20"));
  const drip = Number(arg("drip", "7"));

  let site: { id: string; url: string; vertical: string; gscPropertyUrl: string };
  try {
    site = await resolveSite<{ id: string; url: string; vertical: string; gscPropertyUrl: string }>({ select: { gscPropertyUrl: true } });
  } catch (err) {
    if (reportSiteError(err)) return;
    throw err;
  }

  const [inv, sm] = await Promise.all([fetchServedInventory(site.url), fetchSitemapCounts(site.url)]);

  const ids = await prisma.marketIdentity.findMany({
    where: { vertical: site.vertical },
    select: { zip: true, keywordMetrics: { select: { searchVolume: true } } },
  });
  const volByZip = new Map<string, number>();
  for (const i of ids) {
    const top = [...i.keywordMetrics].sort((a, b) => b.searchVolume - a.searchVolume)[0];
    if (top) volByZip.set(i.zip, top.searchVolume);
  }
  const volByPath = new Map<string, number>();
  for (const [zip, path] of inv.byZip) {
    volByPath.set(path, Math.max(volByPath.get(path) ?? 0, volByZip.get(zip) ?? 0));
  }

  // Chỉ trang nội dung. Hub và trang mục đã ở trong danh sách bấm tay
  // (npm run index:priority) và trộn chúng vào đây sẽ làm hai phép can thiệp
  // chồng lên nhau — lúc đó không tách được tác dụng của cái nào.
  //
  // --dry ĐỌC bảng như lần chạy thật. Ban đầu nó không đọc, để xem trước
  // được khi bảng chưa tồn tại; giờ bảng đã có, và một bản xem trước bỏ qua
  // danh sách loại trừ sẽ in ra một kế hoạch mà lần chạy thật không làm
  // theo — đúng những URL bạn đã bấm tay là những URL nó không biết để bỏ.
  // Xem trước sai còn tệ hơn không có xem trước.
  //
  // Nếu bảng chưa tồn tại (chưa chạy migration), --dry vẫn chạy được và nói
  // rõ là chưa loại trừ được gì, thay vì chết với lỗi Prisma.
  let already: Set<string>;
  try {
    // MỌI provider, không chỉ Omega. Một URL đã bấm tay trong Search
    // Console cũng phải bị loại — nó đã nhận một can thiệp, và để nó
    // vào nhóm đối chứng sẽ làm nhóm đối chứng trông tốt lên vì lý do
    // không liên quan gì tới đối chứng.
    const rows = await prisma.indexSubmission.findMany({
      where: { websiteId: site.id },
      select: { url: true },
    });
    already = new Set(rows.map((r) => r.url));
  } catch (err) {
    if (!dry) throw err;
    console.log("⚠ chưa đọc được bảng IndexSubmission — xem trước NÀY chưa loại trừ gì.");
    console.log(`  (${err instanceof Error ? err.message.split("\n")[0] : String(err)})\n`);
    already = new Set<string>();
  }
  const candidates = sm.urls
    .filter((u) => new URL(u).pathname.split("/").filter(Boolean).length === 3)
    .filter((u) => !already.has(u))
    .sort((a, b) => (volByPath.get(new URL(b).pathname) ?? 0) - (volByPath.get(new URL(a).pathname) ?? 0))
    .slice(0, limit);

  // Trần 2 URL chỉ có nghĩa khi còn phải chia hai nhóm. Với --no-control thì
  // một URL là một lô hợp lệ, và giữ nguyên trần cũ sẽ chặn đúng trường hợp
  // cờ này sinh ra để phục vụ.
  const floor = noControl ? 1 : 2;
  if (candidates.length < floor) {
    console.log(noControl ? "Không còn URL nào để gửi." : "Không đủ URL để chia hai nhóm.");
    return;
  }

  // Chia theo TRẠNG THÁI INDEX trước, rồi mới theo volume trong từng nhóm.
  //
  // Chia thuần theo volume đã đo được là lệch: lô 20 URL cho ra "Google chưa
  // biết tới" 4 bên gửi / 1 bên đối chứng. Nhóm đó vừa là nhóm dịch vụ dễ
  // giúp nhất vừa là nhóm index chậm nhất tự nhiên, nên 4–1 làm kết quả cuối
  // không đọc được theo cả hai chiều: nhóm gửi chậm hơn thì không rõ do dịch
  // vụ kém hay do nó gánh nhiều URL khó hơn.
  //
  // Phân tầng rồi xen kẽ TRONG từng tầng giữ cân cả hai biến cùng lúc.
  const submitted: string[] = [];
  const control: string[] = [];
  let volS = 0;
  let volC = 0;
  const v = (u: string) => volByPath.get(new URL(u).pathname) ?? 0;

  // fetchIndexStates chỉ tồn tại để CHIA cho cân. Không chia thì không gọi —
  // và đó là 131 lệnh gọi URL Inspection không tiêu, trên một quota dùng
  // chung với session khác. Mốc `indexedAtSubmit` phía dưới vẫn đo đủ, nên
  // bỏ bước này không làm mất phép so về sau.
  const byState = noControl
    ? new Map<string, string[]>()
    : await (async () => {
        const stateOf = await fetchIndexStates(site.gscPropertyUrl, candidates);
        const m = new Map<string, string[]>();
        for (const u of candidates) {
          const k = stateOf.get(u) ?? "(không hỏi được)";
          m.set(k, [...(m.get(k) ?? []), u]);
        }
        return m;
      })();

  // MỘT lượt duyệt toàn bộ theo volume giảm dần, không duyệt từng tầng.
  //
  // Duyệt tầng-này-rồi-tầng-kia đẩy lệch volume từ 6,4% lên 14,4%: các trang
  // lớn của tầng sau không còn cơ hội bù cho tầng trước, vì lúc đó tầng
  // trước đã chia xong. Xếp tất cả theo volume rồi gán trang nặng nhất
  // trước vào nhánh đang nhẹ hơn thì mỗi lần gán đều là một lần sửa lệch.
  //
  // Trần theo tầng vẫn giữ: một tầng không được dồn quá ceil(n/2) về một
  // nhánh, nên cân bằng trạng thái không bị volume nuốt mất.
  if (noControl) {
    submitted.push(...[...candidates].sort((a, b) => v(b) - v(a)));
    volS = submitted.reduce((t, u) => t + v(u), 0);
    console.log("--no-control: gửi HẾT, không giữ nhánh đối chứng.");
    console.log("  (10 URL đối chứng của phép thử 14/9 đã bị loại từ bước trên và vẫn đang được đo.)\n");
  } else {
    const stateOfU = new Map<string, string>();
    for (const [k, g] of byState) for (const u of g) stateOfU.set(u, k);
    const capOf = new Map([...byState].map(([k, g]) => [k, Math.ceil(g.length / 2)]));
    const nS = new Map<string, number>();
    const nC = new Map<string, number>();

    for (const u of [...candidates].sort((a, b) => v(b) - v(a))) {
      const st = stateOfU.get(u) ?? "(không hỏi được)";
      const cap = capOf.get(st)!;
      const s0 = nS.get(st) ?? 0;
      const c0 = nC.get(st) ?? 0;
      const toSubmitted = s0 >= cap ? false : c0 >= cap ? true : volS <= volC;
      if (toSubmitted) { submitted.push(u); volS += v(u); nS.set(st, s0 + 1); }
      else { control.push(u); volC += v(u); nC.set(st, c0 + 1); }
    }

    console.log("cân bằng theo trạng thái index:");
    for (const [state, group] of byState) {
      const g = group.filter((u) => submitted.includes(u)).length;
      console.log(`  ${state.padEnd(40)} gửi ${String(g).padStart(2)} | đối chứng ${String(group.length - g).padStart(2)}`);
    }
    console.log();
  }

  console.log(`${candidates.length} URL: gửi ${submitted.length}, đối chứng ${control.length}, drip ${drip} ngày\n`);
  // In xen kẽ theo cặp, không gộp nhóm. Điều cần kiểm bằng mắt là hai nhánh
  // có CÂN về độ quan trọng không; in gộp thì hai cột volume nằm cách nhau
  // năm dòng và không so được. Xen kẽ thì lệch cặp nào đập ngay vào mắt.
  for (let i = 0; i < Math.min(5, submitted.length); i++) {
    console.log(`  GỬI       ${submitted[i].replace(site.url, "").padEnd(44)} ${String(v(submitted[i])).padStart(6)} lượt`);
    if (control[i]) console.log(`  đối chứng ${control[i].replace(site.url, "").padEnd(44)} ${String(v(control[i])).padStart(6)} lượt`);
  }
  const shown = Math.min(5, submitted.length) + Math.min(5, control.length);
  if (candidates.length > shown) console.log(`  … và ${candidates.length - shown} URL nữa`);

  // Tổng volume hai nhánh. Chia xen kẽ theo hạng làm hai nhánh cân, nhưng
  // "làm cho cân" và "đã cân" là hai việc khác nhau — với danh sách lẻ hoặc
  // một trang lớn bất thường, chênh lệch có thật. In ra để thấy, vì nếu hai
  // nhánh lệch nhiều thì kết quả đọc được là chênh lệch độ quan trọng chứ
  // không phải tác dụng của dịch vụ.
  const sum = (a: string[]) => a.reduce((t, u) => t + v(u), 0);
  const [sv, cv] = [sum(submitted), sum(control)];
  if (control.length === 0) {
    // Lệch volume là phép kiểm HAI nhánh có so được với nhau không. Không có
    // nhánh thứ hai thì nó luôn ra 100%, và in một cảnh báo 100% ở đây sẽ dạy
    // người đọc bỏ qua đúng cảnh báo đó khi nó có nghĩa thật.
    console.log(`\ntổng volume gửi đi — ${sv} lượt/tháng`);
  } else {
    const skew = sv + cv === 0 ? 0 : Math.abs(sv - cv) / ((sv + cv) / 2);
    console.log(`\ntổng volume — gửi ${sv}, đối chứng ${cv} (lệch ${(skew * 100).toFixed(1)}%)`);
    if (skew > 0.2) console.log("  ⚠ lệch trên 20%: hai nhánh không so được trực tiếp.");
  }

  if (dry) { console.log("\n--dry: không gửi, không ghi gì."); await prisma.$disconnect(); return; }

  // Đo trạng thái index TRƯỚC khi gửi, cả hai nhóm. Không có mốc này thì
  // phép so sau vài ngày không biết trang nào vốn đã index từ đầu.
  console.log("\nđo trạng thái index trước khi gửi…");
  const before = new Map<string, boolean | null>();
  for (const u of candidates) {
    try {
      before.set(u, await fetchUrlIndexStatus(site.gscPropertyUrl, u));
    } catch {
      before.set(u, null);
    }
  }
  const indexedAlready = [...before.values()].filter(Boolean).length;
  console.log(`  ${indexedAlready}/${candidates.length} đã index sẵn`);

  const campaignName = `hq-${new URL(site.url).hostname}-${arg("tag", "batch")}`;
  const result = await submitToOmega({ urls: submitted, campaignName, dripfeedDays: drip });
  console.log(`\ngửi: ${result.ok ? "OK" : "THẤT BẠI"} — ${result.detail}`);

  // Ghi CẢ hai nhóm, kể cả khi gửi thất bại — nhóm đối chứng vẫn là đối
  // chứng, và biết một lần gửi đã hỏng cũng là dữ liệu.
  for (const [arm, urls] of [["submitted", result.ok ? submitted : []], ["control", control]] as const) {
    for (const url of urls) {
      await prisma.indexSubmission.upsert({
        where: { websiteId_url_provider: { websiteId: site.id, url, provider: PROVIDER } },
        create: {
          websiteId: site.id, url, arm, provider: PROVIDER,
          campaignName: arm === "submitted" ? campaignName : null,
          dripfeedDays: arm === "submitted" ? drip : null,
          indexedAtSubmit: before.get(url) ?? null,
        },
        update: {},
      });
    }
  }
  const n = await prisma.indexSubmission.count({ where: { websiteId: site.id, provider: PROVIDER } });
  console.log(`đã ghi, tổng ${n} URL trong phép thử.`);
  console.log(`\nĐo lại sau 3 và 7 ngày:  tsx scripts/index-experiment.ts`);
  await prisma.$disconnect();
}
main();
