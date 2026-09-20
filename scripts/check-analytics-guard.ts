// Hồi quy phép chặn gtag. systemd timer gọi file này.
//
// Đường import TƯƠNG ĐỐI, không dùng alias "@/": chạy ngoài Next thì tsx phân
// giải theo tsconfig paths và chuỗi đó gãy trên máy chủ — lần đầu dựng pipeline
// đo index tôi viết một file re-export dùng alias và service chết ngay với
// ERR_MODULE_NOT_FOUND. Mọi script khác trong thư mục này đều dùng đường tương
// đối, và đó là lý do.
import { prisma } from "../lib/db/prisma";
import { runAllHostLeakChecks } from "../lib/publisher/host-leak";

async function main() {
  const results = await runAllHostLeakChecks();
  if (results.length === 0) {
    console.log("Không có website nào.");
    return;
  }
  let anyBad = false;
  for (const r of results) {
    if (r.ok) {
      console.log(`✓ ${r.websiteName}: ${r.detail}`);
    } else {
      anyBad = true;
      console.error(`✗ ${r.websiteName}: ${r.detail}`);
    }
  }
  // Thoát khác 0 để `systemctl --failed` và journal thấy được. Một phiên rò
  // duy nhất cũng là hồi quy: thứ đang đo là "còn đường bắn nào không", không
  // phải "rò nhiều hay ít".
  if (anyBad) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
