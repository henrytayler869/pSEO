// Ghi lại URL đã bấm "Request Indexing" bằng tay trong Search Console.
//
// Vì sao phải ghi: những URL đó ĐÃ nhận một can thiệp. Nếu chúng lọt vào
// phép thử Omega — dù ở nhóm gửi hay nhóm đối chứng — thì hai can thiệp
// chồng lên nhau và không tách được tác dụng của cái nào. Một URL bấm tay
// nằm trong nhóm đối chứng còn tệ hơn: nó làm nhóm đối chứng trông tốt lên
// vì lý do không liên quan gì tới đối chứng.
//
// Ghi thành một nhánh thứ ba (arm = "manual") thay vì chỉ loại trừ, vì nó
// cũng là một phép can thiệp đáng đo: nút bấm tay là cơ chế Google công
// nhận, và biết nó hiệu quả đến đâu là thông tin thật.
//
// Dùng:
//   tsx scripts/record-manual-index.ts /moving-services/ny/brooklyn /moving-services/tx/dallas
//   tsx scripts/record-manual-index.ts --file urls.txt
//   tsx scripts/record-manual-index.ts --dry ...   (xem cách hiểu, không ghi)

import { readFileSync } from "node:fs";
import { prisma } from "../lib/db/prisma";
import { resolveSite, reportSiteError } from "../lib/scripts/resolve-site";
import { fetchUrlIndexStatus } from "../lib/google/search-console";

const PROVIDER = "gsc-manual";

async function main() {
  let site: { id: string; url: string; vertical: string; gscPropertyUrl: string };
  try {
    site = await resolveSite<{ id: string; url: string; vertical: string; gscPropertyUrl: string }>({ select: { gscPropertyUrl: true } });
  } catch (err) {
    if (reportSiteError(err)) return;
    throw err;
  }

  const fileIdx = process.argv.indexOf("--file");
  const raw =
    fileIdx >= 0 && process.argv[fileIdx + 1]
      ? readFileSync(process.argv[fileIdx + 1], "utf-8").split(/\r?\n/)
      : process.argv.slice(2);

  const base = site.url.replace(/\/+$/, "");
  const urls = raw
    .map((u) => u.trim())
    .filter(Boolean)
    .filter((u) => !u.startsWith("--"))
    // Nhận cả đường dẫn lẫn URL đầy đủ: người bấm tay copy từ thanh địa chỉ
    // hoặc từ bảng ưu tiên, và bắt họ nhớ dạng nào là mời gõ sai.
    .map((u) => (u.startsWith("http") ? u : `${base}${u.startsWith("/") ? "" : "/"}${u}`));

  if (urls.length === 0) {
    console.error("Không có URL nào. Truyền đường dẫn hoặc --file.");
    process.exitCode = 1;
    return;
  }

  const dry = process.argv.includes("--dry");

  if (dry) {
    // Chỉ in cách hiểu từng dòng. Không gọi Google, không chạm DB — mục đích
    // là bắt lỗi dán nhầm TRƯỚC khi nó thành hàng trong bảng.
    console.log(`${urls.length} URL — xem trước, không ghi:\n`);
    urls.forEach((u) => console.log(`  ${u}`));
    await prisma.$disconnect();
    return;
  }

  console.log(`${urls.length} URL, đo trạng thái index tại thời điểm ghi…\n`);
  let recorded = 0;
  let alreadyIn = 0;
  for (const url of urls) {
    const clash = await prisma.indexSubmission.findFirst({
      where: { websiteId: site.id, url },
      select: { arm: true, provider: true },
    });
    if (clash && clash.provider !== PROVIDER) {
      // URL đã nằm trong phép thử Omega. KHÔNG ghi đè và KHÔNG im lặng: nó
      // đã bị nhiễm, và người chạy phép thử cần biết để loại nó khỏi kết quả.
      console.log(`  ⚠ ${url.replace(base, "")} — đã nằm trong nhánh "${clash.arm}" của ${clash.provider}. Kết quả của URL này không còn sạch.`);
      alreadyIn++;
      continue;
    }

    let indexed: boolean | null = null;
    try {
      indexed = await fetchUrlIndexStatus(site.gscPropertyUrl, url);
    } catch {
      indexed = null;
    }
    await prisma.indexSubmission.upsert({
      where: { websiteId_url_provider: { websiteId: site.id, url, provider: PROVIDER } },
      create: { websiteId: site.id, url, arm: "manual", provider: PROVIDER, indexedAtSubmit: indexed },
      update: {},
    });
    recorded++;
    console.log(`  ✓ ${url.replace(base, "").padEnd(46)} ${indexed === null ? "không đo được" : indexed ? "đã index sẵn" : "chưa index"}`);
  }

  console.log(`\nghi ${recorded} URL vào nhánh "manual"${alreadyIn > 0 ? `, bỏ qua ${alreadyIn} URL đã nhiễm` : ""}.`);
  console.log("Chúng sẽ tự động bị loại khỏi lô Omega: tsx scripts/omega-submit.ts --dry");
  await prisma.$disconnect();
}
main();
