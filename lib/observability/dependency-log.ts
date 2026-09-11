/**
 * Ghi lại lần một phụ thuộc bên ngoài đọc hỏng.
 *
 * Vì sao cần: những chỗ gọi ra ngoài trong repo này đều bắt lỗi rồi VẼ THẲNG
 * vào trang — đúng thiết kế, vì một WordPress đang tắt không nên thành trang
 * lỗi của Next và che mất phần còn lại. Nhưng hệ quả là production KHÔNG GHI
 * GÌ: đo 11/9/2026, 1.324 dòng log 7 ngày của pseo.service không có lấy một
 * dòng "fetch failed".
 *
 * Con số 0 đó không chứng minh được gì. Nếu WordPress từng chết mười phút,
 * log vẫn sẽ là 0 — lỗi đã nằm gọn trong một trang không ai mở lúc đó. Đây là
 * kiểu tín hiệu không thể kêu, chỉ khác là nó ở production.
 *
 * Một dòng, có tiền tố cố định để grep được:
 *   [dep-fail] source=wordpress site=<id> detail=<...>
 */

/** Chặn một phụ thuộc đang hỏng làm ngập log.
 *
 * Mỗi khoá một dòng mỗi 60 giây. Vẫn đủ để đọc ra sự cố kéo dài bao lâu —
 * một dòng mỗi phút vẽ ra khoảng thời gian — mà không biến một lần F5 liên
 * tục thành nghìn dòng giống nhau.
 *
 * Đánh đổi ghi rõ ở đây: trong vòng 60 giây đó, KHÔNG có dòng nào không có
 * nghĩa là không có lỗi nào. Con số lần hỏng không đọc được từ log này; chỉ
 * đọc được là nó bắt đầu lúc nào và còn tới lúc nào.
 */
const lastLoggedAt = new Map<string, number>();
const THROTTLE_MS = 60_000;

export function logDependencyFailure(source: string, err: unknown, context: Record<string, string | null> = {}): void {
  const key = `${source}:${Object.values(context).join("|")}`;
  const now = Date.now();
  const last = lastLoggedAt.get(key);
  if (last !== undefined && now - last < THROTTLE_MS) return;
  lastLoggedAt.set(key, now);

  const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
  const pairs = Object.entries(context)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

  // console.error chứ không phải console.log: systemd gom stderr riêng, nên
  // `journalctl -p err` lọc ra được mà không phải đọc cả 1.324 dòng.
  console.error(`[dep-fail] source=${source}${pairs ? ` ${pairs}` : ""} detail=${detail}`);
}
