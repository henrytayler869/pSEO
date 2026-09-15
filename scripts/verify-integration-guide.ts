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
import { getCredential } from "../lib/settings/credentials";
import { fetchOnPageSummary } from "../lib/dataforseo/on-page";
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
      // Bảng chứa BA loại đoạn (cụm, hub bang, hub một-ZIP) nên con số phải
      // đối chiếu tổng, và guide phải nêu cả ba — nêu mỗi "31 cụm" sẽ đúng
      // về một loại và sai về bảng.
      const m = doc.match(/\*\*(\d+) đoạn đạt\*\*/);
      if (!m) return "guide không còn nêu tổng số đoạn để đối chiếu";
      return Number(m[1]) === passed
        ? null
        : `guide ghi ${m[1]} đoạn, thực tế ${passed}`;
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
  {
    name: "guide cảnh báo /cdn-cgi/, và site thật đang chặn nó",
    run: async () => {
      const doc = readFileSync(GUIDE, "utf-8");
      if (!doc.includes("/cdn-cgi/l/email-protection")) return "guide chưa cảnh báo";
      // Kiểm robots.txt THẬT, không kiểm code: Cloudflare chèn khối riêng
      // phía trên khối của site, nên file crawler nhận được khác thứ
      // app/robots.ts sinh ra. Đây cũng chính là điều mục 3.11 dặn.
      const site = await resolveSite();
      const res = await fetch(`${site.url}/robots.txt`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return `robots.txt trả HTTP ${res.status}`;
      const body = await res.text();
      return /Disallow:\s*\/cdn-cgi\//i.test(body) ? null : "robots.txt thật KHÔNG chặn /cdn-cgi/";
    },
  },
  {
    name: "guide nêu đủ BA lệnh sinh, và cả ba script tồn tại",
    run: async () => {
      const doc = readFileSync(GUIDE, "utf-8");
      // Ba loại trang cần đoạn, ba lệnh. Bỏ sót một lệnh nghĩa là một loại
      // trang im lặng không có chữ — và hub bang chính là loại Google đã
      // đọc rồi từ chối, nên bỏ sót nó là bỏ sót đúng chỗ đang đau.
      const scripts = [
        "scripts/generate-cluster-text.ts",
        "scripts/generate-state-text.ts",
        "scripts/generate-solo-state-text.ts",
      ];
      const missingFile = scripts.filter((f) => !existsSync(f));
      if (missingFile.length > 0) return `guide mô tả script không tồn tại: ${missingFile.join(", ")}`;
      const cmds = ["cluster:generate", "state:generate", "solo-state:generate"];
      const missingDoc = cmds.filter((c) => !doc.includes(c));
      if (missingDoc.length > 0) return `guide chưa nêu lệnh: ${missingDoc.join(", ")}`;
      // Và npm phải chạy được chúng — một lệnh có trong tài liệu mà không có
      // trong package.json là một lệnh người ta gõ rồi gặp lỗi.
      const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts: Record<string, string> };
      const missingPkg = cmds.filter((c) => !pkg.scripts[c]);
      return missingPkg.length > 0 ? `package.json thiếu lệnh: ${missingPkg.join(", ")}` : null;
    },
  },
  {
    name: "guide nêu mọi lỗi OnPage đang dính, không bỏ sót mục nào",
    run: async () => {
      const doc = readFileSync(GUIDE, "utf-8");
      // Không so với một danh sách chép tay: hỏi thẳng DataForSEO xem site
      // đang dính gì, rồi đòi guide có nhắc từng mục. Danh sách chép tay sẽ
      // đứng yên trong khi site đổi, và lúc đó check vẫn xanh.
      const [login, password] = await Promise.all([
        getCredential("DATAFORSEO_LOGIN"),
        getCredential("DATAFORSEO_PASSWORD"),
      ]);
      const site = await prisma.website.findFirst({ select: { onPageTaskId: true } });
      if (!login || !password || !site?.onPageTaskId) return null; // chưa cấu hình thì không kết luận
      const sum = await fetchOnPageSummary(login, password, site.onPageTaskId);
      // Chỉ đòi với mục dính từ 10 trang trở lên. Một lỗi trên 1 trang là
      // chuyện của trang đó, không phải bài học cho site mới.
      const big = sum.issues.filter((i) => i.count >= 10);
      const missing = big.filter((i) => !doc.includes(i.key));
      return missing.length === 0
        ? null
        : `guide chưa nhắc: ${missing.map((m) => `${m.key} (${m.count} trang)`).join(", ")}`;
    },
  },
  {
    name: "guide nói đúng lớp ZIP thiếu tên hạt, và lớp đó chưa đổi",
    run: async () => {
      const doc = readFileSync(GUIDE, "utf-8");
      if (!/county === null/.test(doc)) return "guide chưa nêu nhánh county null";
      // Đối chiếu với DB, không tin con số chép tay. Guide khẳng định "đúng
      // 5 hàng, cả 5 đều CÓ countyFips" và "06902 có cầu ở 7 niche" — hai
      // khẳng định đó đổi được khi dữ liệu đổi, và lúc đó guide dạy sai.
      const nulls = await prisma.location.count({ where: { county: null } });
      const nullsWithFips = await prisma.location.count({ where: { county: null, countyFips: { not: null } } });
      if (nulls !== nullsWithFips) {
        return `có ${nulls - nullsWithFips} ZIP thiếu CẢ county lẫn countyFips — guide nói cả 5 đều có countyFips, không còn đúng`;
      }
      const m = doc.match(/đúng \*\*(\d+) hàng `county: null`/);
      if (!m) return "guide không còn nêu số hàng county null để đối chiếu";
      return Number(m[1]) === nulls ? null : `guide ghi ${m[1]} hàng, thực tế ${nulls}`;
    },
  },
  {
    name: "ca ÂM: URL không tồn tại trả 404 CỨNG ngay lần gọi đầu",
    run: async () => {
      const doc = readFileSync(GUIDE, "utf-8");
      if (!/soft 404/i.test(doc)) return "guide chưa cảnh báo soft 404";
      const site = await resolveSite();

      // URL NGẪU NHIÊN, chưa ai từng gọi. Dùng một URL cố định là tự lừa
      // mình: site đầu đo được "lần gọi ĐẦU 200, lần thứ hai trở đi 404",
      // nên một URL đã gọi ở lần chạy trước sẽ trả 404 từ cache và check
      // xanh trên một site đang phục vụ soft 404 cho mọi khách mới.
      const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
      const url = `${site.url}/moving-services/ny/khong-ton-tai-${nonce}`;

      // Gọi HAI lần, đòi CẢ HAI cùng 404 — lần đầu bắt App Shell, lần hai
      // bắt trường hợp ngược lại (404 rồi lại phục vụ 200 từ cache).
      const codes: number[] = [];
      for (let i = 0; i < 2; i++) {
        const r = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "manual" });
        codes.push(r.status);
      }
      return codes.every((c) => c === 404)
        ? null
        : `URL không tồn tại trả ${codes.join(" rồi ")} — 200 ở đây là soft 404, crawler đọc nó như một trang thật`;
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
