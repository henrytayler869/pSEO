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

import { readFileSync, existsSync } from "node:fs";
import { fetchServedInventory } from "../lib/publisher/inventory";
import { clusterIdOf } from "../lib/ai/cluster-facts";
import { prisma } from "../lib/db/prisma";
import { resolveSite } from "../lib/scripts/resolve-site";

/** Số truy vấn cache aiGeneration trong lib/ai/generate.ts.
 *
 * Cố định để một truy vấn MỚI xuất hiện cũng làm check đỏ: nó có thể là
 * đường đọc cache thứ ba, và một đường không ai soi là đường duy nhất cần
 * soi. */
const EXPECTED_CACHE_QUERIES = 2;

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
      const site = await resolveSite();
      const inv = await fetchServedInventory(site.url);
      return inv.byZip.size > 0 ? null : "endpoint trả 0 ZIP";
    },
  },
  {
    name: "inventory trả cả kind — guide dựa vào nó để nói zip nào hiện đoạn AI",
    run: async () => {
      const site = await resolveSite();
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
      const site = await resolveSite();
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
  {
    name: "guide mô tả /cluster-interpretation, và route đó tồn tại thật",
    run: async () => {
      const doc = readFileSync(GUIDE, "utf-8");
      if (!doc.includes("cluster-interpretation")) return "guide chưa nhắc endpoint trang cụm";
      // Kiểm route có thật, không chỉ kiểm chữ trong tài liệu. Mục 3.7c ra
      // đời vì site đầu tiên bỏ sót trang cụm mà KHÔNG có lỗi nào báo; một
      // check chỉ đọc tài liệu sẽ mắc đúng bệnh đó ở tầng khác.
      return existsSync("app/api/v1/niches/[vertical]/cluster-interpretation/route.ts")
        ? null
        : "guide mô tả một endpoint không tồn tại";
    },
  },
  {
    name: "guide nói khớp cụm là ĐÚNG TOÀN BỘ TẬP, và code cũng vậy",
    run: async () => {
      const doc = readFileSync(GUIDE, "utf-8");
      if (!/Khớp phải đúng toàn bộ tập/i.test(doc)) return "guide chưa nêu ràng buộc khớp đủ tập";
      // clusterIdOf băm TẬP ZIP đã sắp xếp. Nếu ai đó đổi sang khoá theo
      // nhãn hay theo từ khoá, thiếu một ZIP sẽ không còn đổi clusterId —
      // và trang 22 ZIP nhận đoạn của cụm 23 ZIP: dải có hai đầu mà trang
      // không chứa. Số đúng, nguồn đúng, vẫn sai.
      const a = clusterIdOf("moving-services", ["11201", "11203", "11204"]);
      const shuffled = clusterIdOf("moving-services", ["11204", "11201", "11203"]);
      const missing = clusterIdOf("moving-services", ["11201", "11203"]);
      if (a !== shuffled) return "xáo thứ tự lại ra clusterId khác — site sẽ phải tự sắp, guide nói là không cần";
      if (a === missing) return "thiếu một ZIP vẫn ra cùng clusterId — trang cụm sẽ nhận đoạn của cụm khác";
      return null;
    },
  },
  {
    name: "mọi cụm đã sinh đều đọc được — số trang cụm khớp số đoạn",
    run: async () => {
      const passed = await prisma.aiClusterGeneration.count({ where: { validationPassed: true } });
      if (passed === 0) return "chưa có đoạn cụm nào — trang cụm sẽ không có chữ AI";
      const doc = readFileSync(GUIDE, "utf-8");
      const m = doc.match(/\*\*(\d+)\/(\d+)\*\*\. Nếu site có/);
      if (!m) return "guide không còn nêu số cụm để đối chiếu";
      return Number(m[1]) === passed
        ? null
        : `guide ghi ${m[1]} đoạn cụm, thực tế ${passed}`;
    },
  },
  {
    name: "guide cảnh báo đoạn theo ZIP cache theo NGÀNH, không theo site",
    run: async () => {
      const doc = readFileSync(GUIDE, "utf-8");
      if (!/cache theo NGÀNH, không theo site/i.test(doc)) return "guide chưa cảnh báo";
      // Kiểm CODE chứ không chỉ kiểm chữ. Ngày nào đó ai đó thêm websiteId
      // vào khoá cache thì cảnh báo này thành sai — và một cảnh báo sai
      // hướng người ta tránh một vấn đề không còn tồn tại, hoặc tệ hơn,
      // làm họ nghi ngờ những cảnh báo còn đúng.
      //
      // Đòi MỌI truy vấn cache, không phải "có một cái sạch". Bản đầu của
      // check này chỉ tìm một truy vấn khớp mẫu, nên khi đột biến thêm
      // websiteId vào truy vấn THỨ NHẤT, regex không khớp nó nữa và check
      // vẫn xanh nhờ truy vấn thứ hai. Một check bỏ qua đúng thứ nó canh.
      const src = readFileSync("lib/ai/generate.ts", "utf-8");
      const queries = src.match(/prisma\.aiGeneration\.findFirst\(\{[\s\S]*?\n  \}\)/g) ?? [];
      if (queries.length !== EXPECTED_CACHE_QUERIES) {
        return `đếm được ${queries.length} truy vấn cache aiGeneration, trước đây là ${EXPECTED_CACHE_QUERIES} — đọc lại lib/ai/generate.ts rồi cập nhật check`;
      }
      const tainted = queries.filter((q) => q.includes("websiteId"));
      return tainted.length > 0
        ? `${tainted.length}/${queries.length} truy vấn cache đã có websiteId — cảnh báo trong guide không còn đúng`
        : null;
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
