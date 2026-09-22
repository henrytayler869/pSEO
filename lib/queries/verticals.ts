import { prisma } from "@/lib/db/prisma";

/**
 * Nghề đã có TRANG trong hệ thống, đọc từ dữ liệu.
 *
 * Một hàm, dùng bởi CẢ form nối site (để mời chọn) và server action (để từ
 * chối thứ khác). Hai danh sách sẽ trôi lệch, và độ lệch sẽ hiện ra dưới dạng
 * một form mời một nghề mà action từ chối — người điền form đọc ra là form
 * hỏng.
 *
 * Đọc chứ không khai, cùng lý do `metricResolutions` đọc chứ không khai: một
 * danh sách viết cứng ở đây sẽ là định nghĩa thứ hai về "nghề là gì", còn định
 * nghĩa thứ nhất nằm trong dữ liệu.
 *
 * ═══ HAI BẢNG, VÌ CÓ HAI TRỤC TRANG ═══
 *
 * Trước 22/9/2026 hàm này chỉ đọc `MarketIdentity`, và tên cũ của nó —
 * `getVerticalsWithMarkets` — nói đúng điều đó. Nhưng "có market" chưa bao
 * giờ là câu hỏi thật; câu hỏi thật là "nghề này đã có trang để dựng chưa".
 * Với trục địa lý hai câu đó trùng nhau, nên khác biệt không lộ ra.
 *
 * Nghề bóng đá làm chúng tách nhau: nó có 96 trang đội và 876 trang đối đầu
 * mà KHÔNG có một hàng `MarketIdentity` nào, vì trang của nó không gắn với mã
 * ZIP nào cả (xem `EntityIdentity`). Đọc bảng cũ thôi thì nó bị từ chối nối
 * site — và thông báo sẽ nói "chưa có market nào", gửi người ta đi tìm một
 * file coverage không bao giờ tồn tại.
 *
 * KHÔNG lấp bằng cách chèn hàng `MarketIdentity` giả với zip bịa. Cột `zip`
 * và `state` của bảng đó không nullable, nên "lấp tạm" nghĩa là viết một mã
 * ZIP không có thật vào một bảng mà mọi truy vấn địa lý khác đều đọc.
 */
export async function getVerticalsWithPages(): Promise<string[]> {
  const [geo, entity] = await Promise.all([
    prisma.marketIdentity.findMany({ select: { vertical: true }, distinct: ["vertical"] }),
    prisma.entityIdentity.findMany({ select: { vertical: true }, distinct: ["vertical"] }),
  ]);
  const all = new Set([...geo.map((r) => r.vertical), ...entity.map((r) => r.vertical)]);
  // Sắp xếp để thứ tự trên form không đổi giữa hai lần render mà không vì gì.
  return [...all].sort((a, b) => a.localeCompare(b));
}
