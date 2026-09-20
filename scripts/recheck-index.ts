// Điểm vào của pipeline đo lại index. systemd timer gọi file này.
//
// KHÔNG tự nạp dotenv: `import { prisma }` kéo @prisma/client, và chính nó nạp
// .env của thư mục làm việc vào process.env. Đó là lý do mọi script tsx trong
// kho này chạy được trên máy chủ dù deploy/pseo.service cố ý KHÔNG có
// EnvironmentFile. Thêm một bộ nạp thứ hai ở đây sẽ đọc cùng file dưới luật
// trích dẫn khác — đúng cái bẫy mà chú thích trong unit file đã cảnh báo.
//
// In ra mọi kết quả, kể cả BỎ QUA. Một lần chạy im lặng trong journal thì
// không phân biệt được với một lần chạy không xảy ra.
import { prisma } from "../lib/indexing/prisma-reexport";
import { runDueRechecks } from "../lib/indexing/schedule";

async function main() {
  const outcomes = await runDueRechecks();
  if (outcomes.length === 0) {
    console.log("Không có website nào.");
    return;
  }
  let anyError = false;
  for (const o of outcomes) {
    if (o.error) {
      anyError = true;
      console.error(`✗ ${o.websiteName}: ${o.error}`);
    } else if (o.skipped) {
      console.log(`· ${o.websiteName}: bỏ qua — ${o.skipped}`);
    } else {
      console.log(`✓ ${o.websiteName}: đo ${o.checked} URL${o.failed > 0 ? `, ${o.failed} URL hỏi không được` : ""}`);
    }
  }
  // Thoát khác 0 khi có lỗi, để `systemctl list-units --failed` thấy được.
  if (anyError) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
