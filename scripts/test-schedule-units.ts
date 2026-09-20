/**
 * Nhịp trong kho và nhịp trên máy phải là MỘT.
 *
 * Chính sách sống ở lib/indexing/schedule.ts, nhịp tim sống ở file .timer, và
 * màn hình dùng hằng số trong kho để nói "pipeline còn sống không". Lệch nhau
 * thì màn hình sẽ báo chết trong khi timer vẫn chạy, hoặc tệ hơn: báo sống
 * trong khi timer đã dừng từ lâu.
 *
 * Đây là loại bất biến mà hôm nay tôi vừa gặp một cái KHÔNG kiểm được (hai
 * launch.json ở hai kho, không CI nào thấy cả hai). Cái này thì kiểm được —
 * cả hai file cùng nằm trong kho — nên nó phải có cổng chứ không phải một câu
 * hứa trong chú thích.
 */
import { readFileSync } from "node:fs";
import { HEARTBEAT_HOURS, RECHECK_INTERVAL_HOURS } from "@/lib/indexing/schedule";

let failed = 0;
function check(ok: boolean, label: string) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failed++;
}

const timer = readFileSync("deploy/pseo-index-recheck.timer", "utf8");
console.log("pseo-index-recheck:");
const m = /^OnUnitActiveSec=(\d+)(h|min|s)$/m.exec(timer);
check(m !== null, "timer khai OnUnitActiveSec ở dạng đọc được");

if (m) {
  const hours = m[2] === "h" ? Number(m[1]) : m[2] === "min" ? Number(m[1]) / 60 : Number(m[1]) / 3600;
  check(hours === HEARTBEAT_HOURS, `nhịp tim khớp: timer ${m[1]}${m[2]} = HEARTBEAT_HOURS ${HEARTBEAT_HOURS}`);
  check(
    hours < RECHECK_INTERVAL_HOURS,
    `timer gọi DÀY HƠN nhịp đo (${hours}h < ${RECHECK_INTERVAL_HOURS}h) — nếu không, mỗi lần gọi đều rơi vào "chưa tới hạn" và không bao giờ đo`,
  );
}

const service = readFileSync("deploy/pseo-index-recheck.service", "utf8");
check(/^Unit=pseo-index-recheck\.service$/m.test(timer), "timer trỏ đúng service");
check(/^ExecStart=.*scripts\/recheck-index\.ts$/m.test(service), "service gọi đúng script");
// Chỉ THỊ ở đầu dòng, không phải chữ ở bất kỳ đâu: chú thích ngay trong
// file đó GIẢI THÍCH vì sao không dùng EnvironmentFile, và một mốc khớp chữ
// trần sẽ bắt đúng lời giải thích của chính nó. Cùng lỗi với INTERNAL_ADDRESS
// bên kho publisher sáng nay, cùng cách sửa: săn chỉ thị, không săn chữ.
check(!/^EnvironmentFile=/m.test(service), "service KHÔNG có EnvironmentFile — .env do Prisma tự nạp, nạp hai lần là hai luật trích dẫn");
check(/^Persistent=true$/m.test(timer), "Persistent=true — reboot qua một nhịp thì chạy bù, không để trống chuỗi đo");

/**
 * Cặp unit thứ hai — hồi quy gtag.
 *
 * KHÔNG kiểm "nhịp khớp hằng số" như cặp trên, và đó là chủ ý chứ không phải
 * bỏ sót: pipeline index có một nhịp CHÍNH SÁCH trong mã (24h) mà timer chỉ
 * là nhịp tim, nên hai con số phải khớp. Phép kiểm gtag đọc thẳng GA4 mỗi lần
 * chạy, không có lớp "đã tới hạn chưa", nên timer LÀ nhịp thật và không có
 * hằng số nào để lệch với nó. Bịa ra một phép so ở đây sẽ là một cổng canh
 * không canh gì.
 */
console.log("\npseo-analytics-guard:");
const guardTimer = readFileSync("deploy/pseo-analytics-guard.timer", "utf8");
const guardService = readFileSync("deploy/pseo-analytics-guard.service", "utf8");
check(/^OnUnitActiveSec=\d+(h|min|s)$/m.test(guardTimer), "timer khai OnUnitActiveSec ở dạng đọc được");
check(/^Unit=pseo-analytics-guard\.service$/m.test(guardTimer), "timer trỏ đúng service");
check(/^ExecStart=.*scripts\/check-analytics-guard\.ts$/m.test(guardService), "service gọi đúng script");
check(!/^EnvironmentFile=/m.test(guardService), "service KHÔNG có EnvironmentFile");
check(/^Persistent=true$/m.test(guardTimer), "Persistent=true");
check(
  // Hai unit RIÊNG. Gộp thì một phép kiểm gãy che phép kia, và systemctl
  // --failed sẽ nói sai tên thứ đang hỏng.
  !guardService.includes("recheck-index") && !service.includes("check-analytics-guard"),
  "hai service gọi hai script khác nhau — không unit nào ôm cả hai phép kiểm",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} phép kiểm hỏng.`);
  process.exit(1);
}
console.log("\n✓ nhịp trong kho và nhịp trên máy là một.");
