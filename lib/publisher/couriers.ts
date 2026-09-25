import { prisma } from "@/lib/db/prisma";
import { isHeaderSafeSecret } from "@/lib/publisher/push-key";

/**
 * Các site đủ điều kiện làm TRUNG CHUYỂN cho một lần đẩy khoá.
 *
 * Vì sao một site lại đẩy được khoá của site khác: mọi publisher chạy từ MỘT
 * kho, một build, một tiến trình, và ghi vào cùng một file `.hq-key`. Host chỉ
 * là thứ phân biệt lúc đọc. Nên `POST /api/hq-key` tới host nào cũng tới đúng
 * một chỗ, và endpoint bên đó nhận `host` trong body để biết ghi cho ai.
 *
 * Điều kiện là ĐANG SỐNG, và không kiểm được từ đây. Hàng trong bảng chỉ nói
 * site có secret, không nói DNS phân giải hay chứng chỉ còn hạn — nên danh
 * sách này là ỨNG VIÊN, và lần đẩy hụt sẽ nói ra lý do thật. Chọn site vừa
 * deploy thành công gần nhất.
 */
export interface CourierSite {
  id: string;
  url: string;
  name: string;
}

export async function listCourierSites(targetWebsiteId: string): Promise<CourierSite[]> {
  const rows = await prisma.website.findMany({
    where: { id: { not: targetWebsiteId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, url: true, name: true, revalidateSecret: true },
  });

  // Lọc ở đây, không ở UI: một ô chọn liệt kê site không đẩy được là một ô
  // chọn dẫn người ta tới một lỗi lẽ ra biết trước. `isHeaderSafeSecret` chứ
  // không chỉ `!= null` — secret có dấu sẽ bị chặn ở tầng dưới, và chặn SAU
  // khi đã sinh khoá thì khoá đó thành rác phải thu hồi.
  return rows
    .filter((r) => r.revalidateSecret !== null && isHeaderSafeSecret(r.revalidateSecret))
    .map(({ id, url, name }) => ({ id, url, name }));
}

/**
 * Secret của site trung chuyển, đọc TỪ DB chứ không nhận từ form.
 *
 * Form chỉ gửi id. Nhận cả secret từ client nghĩa là ai gửi được một POST đều
 * chỉ định được cả nơi khoá đi tới lẫn thứ mở cửa ở đó.
 */
export async function resolveCourier(
  id: string,
  targetWebsiteId: string
): Promise<{ url: string; revalidateSecret: string; name: string } | { error: string }> {
  if (id === targetWebsiteId) {
    return { error: "Site trung chuyển phải khác site đích." };
  }
  const row = await prisma.website.findUnique({
    where: { id },
    select: { url: true, name: true, revalidateSecret: true },
  });
  if (!row) return { error: "Không tìm thấy site trung chuyển." };
  if (!row.revalidateSecret) {
    return { error: `${row.name} chưa có revalidate secret nên không trung chuyển được.` };
  }
  return { url: row.url, revalidateSecret: row.revalidateSecret, name: row.name };
}
