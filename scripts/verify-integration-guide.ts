// Kiểm những khẳng định KIỂM ĐƯỢC trong docs/SITE_INTEGRATION_GUIDE.md.
//
// Tài liệu này mô tả một hợp đồng giữa hai repo, và hợp đồng chỉ có giá trị
// khi hai bên còn khớp. Đo 13/9/2026: mục 3.4 mô tả một thiết kế site đã bỏ
// từ lâu (một trang mỗi zip, lớp AI bắt buộc cho zip trong cụm), trong khi
// site thật dựng một trang mỗi CỤM và không render lớp AI ở đó. Một session
// mới đọc mục đó sẽ dựng lại đúng vấn đề mà thiết kế hiện tại đã xoá.
//
// Không kiểm được văn xuôi. Kiểm được: endpoint có tồn tại không, hình dạng
// phản hồi có đúng như tài liệu mô tả không, và những con số tài liệu nêu có
// còn đúng không.
//
// Dùng: tsx scripts/verify-integration-guide.ts

import { readFileSync } from "node:fs";
import { fetchServedInventory } from "../lib/publisher/inventory";
import { prisma } from "../lib/db/prisma";

const GUIDE = "docs/SITE_INTEGRATION_GUIDE.md";

interface Check {
  name: string;
  run: () => Promise<string | null>;
}

const checks: Check[] = [
  {
    name: "guide mô tả /api/inventory, và endpoint đó tồn tại thật",
    run: async () => {
      const doc = readFileSync(GUIDE, "utf-8");
      if (!doc.includes("GET /api/inventory")) return "guide không mô tả /api/inventory";
      const site = await prisma.website.findFirst({ select: { url: true } });
      if (!site) return "không có website nào để kiểm";
      const inv = await fetchServedInventory(site.url);
      return inv.byZip.size > 0 ? null : "endpoint trả 0 ZIP";
    },
  },
  {
    name: "inventory trả cả kind — guide dựa vào nó để nói zip nào hiện đoạn AI",
    run: async () => {
      const site = await prisma.website.findFirst({ select: { url: true } });
      if (!site) return "không có website nào";
      const inv = await fetchServedInventory(site.url);
      const kinds = new Set(inv.kindByZip.values());
      if (kinds.size === 0) return "không ZIP nào có kind";
      return kinds.has("market") && kinds.has("cluster")
        ? null
        : `chỉ thấy kind: ${[...kinds].join(", ")} — guide mô tả cả hai`;
    },
  },
  {
    name: "guide đã ĐÍNH CHÍNH mục 3.4 về trang cụm",
    run: async () => {
      const doc = readFileSync(GUIDE, "utf-8");
      return doc.includes("ĐÍNH CHÍNH") && doc.includes("cluster-view")
        ? null
        : "mục 3.4 chưa có đính chính về việc trang cụm không render lớp AI";
    },
  },
  {
    name: "số trang guide nêu (158) còn khớp site",
    run: async () => {
      const site = await prisma.website.findFirst({ select: { url: true } });
      if (!site) return "không có website nào";
      const inv = await fetchServedInventory(site.url);
      const doc = readFileSync(GUIDE, "utf-8");
      if (!doc.includes(String(inv.pageCount))) {
        return `site có ${inv.pageCount} trang, guide không nhắc con số đó — cập nhật hoặc bỏ con số khỏi guide`;
      }
      return null;
    },
  },
  {
    name: "guide cảnh báo per_page tối đa 100 của WordPress",
    run: async () => {
      const doc = readFileSync(GUIDE, "utf-8");
      return /per_page[\s\S]*100|100[\s\S]*per_page/.test(doc) ? null : "chưa cảnh báo";
    },
  },
  {
    name: "guide yêu cầu ý định tìm kiếm đo theo từng thị trường",
    run: async () => {
      const doc = readFileSync(GUIDE, "utf-8");
      return doc.includes("search_intent") && doc.includes("TỪNG thị trường") ? null : "chưa có";
    },
  },
];

async function main() {
  let ok = 0;
  const failures: string[] = [];
  for (const c of checks) {
    let err: string | null;
    try {
      err = await c.run();
    } catch (e) {
      err = e instanceof Error ? e.message.split("\n")[0] : String(e);
    }
    if (err === null) ok++;
    else failures.push(`${c.name}\n      ${err}`);
    console.log(`${err === null ? "✓" : "✗"} ${c.name}`);
  }
  console.log(`\n${ok}/${checks.length} khẳng định còn đúng.`);
  if (failures.length > 0) {
    console.error(`\nLỆCH:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}
main();
