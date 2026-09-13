/**
 * ZIP nào publisher ĐÃ có trang phục vụ — đọc từ chính publisher.
 *
 * Trước đây HQ suy ra từ sitemap bằng cách ghép tên thành phố thành đường
 * dẫn. Đo 12/9/2026: cách đó bỏ sót gần hết. Site dùng ba dạng URL, và tệ
 * hơn, trang CỤM đặt tên theo TỪ KHOÁ chứ không theo tên thành phố — những
 * ZIP sau /moving-services/ny/brooklyn đều mang city "New York" trong dữ liệu
 * HQ, nên không phép ghép nào theo tên thành phố tìm ra chúng.
 *
 * Kết quả: danh sách mời viết 174 bài cho 174 market đã có trang.
 *
 * Quy tắc cụm thuộc Pubsite (isPublishable: clusterSize <= 1). Sao chép nó
 * sang đây là tạo định nghĩa thứ hai về việc trang nào tồn tại. Nên Pubsite
 * công bố ở /api/inventory, và HQ đọc — một nguồn, bên sở hữu quyết định giữ.
 */

export interface ServedInventory {
  /** ZIP -> đường dẫn trang đang phục vụ nó. */
  byZip: Map<string, string>;
  /**
   * ZIP -> loại trang phục vụ nó.
   *
   * "market" = trang riêng, có render đoạn AI diễn giải.
   * "cluster" = trang gộp nhiều ZIP, KHÔNG render đoạn AI nào.
   *
   * Phân biệt này tốn tiền thật mới biết. Đo 13/9/2026: sinh lại 35 đoạn
   * theo ý định, 9 trong số đó thuộc ZIP nằm trong cụm — cluster-view.tsx
   * bên Pubsite không tham chiếu tới lớp AI, nên 9 đoạn ấy không xuất hiện
   * trên trang nào. Khoảng $0.20 cho chữ không ai đọc.
   *
   * Nơi nào sinh lại nội dung theo lô nên lọc theo trường này.
   */
  kindByZip: Map<string, "market" | "cluster">;
  pageCount: number;
  generatedAt: string | null;
}

export async function fetchServedInventory(siteUrl: string): Promise<ServedInventory> {
  const base = siteUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/inventory`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Publisher trả HTTP ${res.status} cho /api/inventory.`);

  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null) throw new Error("Phản hồi /api/inventory không phải object.");
  const entries = (body as Record<string, unknown>).entries;
  if (!Array.isArray(entries)) throw new Error("Phản hồi /api/inventory thiếu mảng entries.");

  const byZip = new Map<string, string>();
  const kindByZip = new Map<string, "market" | "cluster">();
  for (const e of entries) {
    if (typeof e !== "object" || e === null) continue;
    const zip = (e as Record<string, unknown>).zip;
    const path = (e as Record<string, unknown>).path;
    const kind = (e as Record<string, unknown>).kind;
    if (typeof zip !== "string" || typeof path !== "string") continue;
    byZip.set(zip, path);
    if (kind === "market" || kind === "cluster") kindByZip.set(zip, kind);
  }
  // Mảng entries rỗng KHÔNG được coi là "site chưa có trang nào": nó gần như
  // luôn nghĩa là phản hồi sai hình dạng, và coi nó là 0 sẽ mở lại đúng lỗi
  // mời viết trùng 174 bài.
  if (byZip.size === 0) throw new Error("/api/inventory trả về 0 ZIP — coi là lỗi, không coi là site trống.");

  const pageCount = (body as Record<string, unknown>).pageCount;
  const generatedAt = (body as Record<string, unknown>).generatedAt;
  return {
    byZip,
    kindByZip,
    pageCount: typeof pageCount === "number" ? pageCount : new Set(byZip.values()).size,
    generatedAt: typeof generatedAt === "string" ? generatedAt : null,
  };
}
