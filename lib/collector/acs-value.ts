/**
 * Đọc MỘT ô của phản hồi ACS5, và phép vũ trụ-rỗng đi kèm.
 *
 * ═══ VÌ SAO TỒN TẠI: `Number(null) === 0` ═══
 *
 * Ba adapter ACS5 mỗi cái tự viết `parseAcsValue`, và cả ba giống hệt nhau:
 *
 *     const n = Number(raw);
 *     if (!Number.isFinite(n) || n === SUPPRESSED_VALUE || n < 0) return null;
 *     return n;
 *
 * Census trả JSON `null` cho ô không có ước lượng. `Number(null)` là **0** —
 * hữu hạn, không âm, không phải sentinel — nên nó qua sạch cả ba phép kiểm và
 * trở thành một số 0 THẬT trong DataPoint.
 *
 * Đo 27/9/2026 trên DB production: 270 hàng `census_moved_*` mang value 0, trải
 * trên 6 Location. Bốn trong đó — 00725, 00926, 00949, 00956, toàn Puerto Rico
 * — có CẢ BỐN chỉ số đếm bằng 0, trong khi phản hồi ACS5 2023 cho chúng là
 * `null` ở mọi trường. Tức không phải Census nói "không ai chuyển đến"; là chỗ
 * này đọc "không biết" thành "bằng 0".
 *
 * Hai ZIP còn lại (20002, 20011 Washington DC) chỉ 0 ở `from_different_county`,
 * và đó là SỐ THẬT — DC chỉ có một hạt nên không ai đến từ hạt khác trong cùng
 * bang được. Nên phép sửa KHÔNG được vơ đũa cả nắm: một số 0 có vũ trụ là dữ
 * liệu, một số 0 không có vũ trụ là chỗ trống.
 *
 * ═══ VÌ SAO NGUY HIỂM HƠN MỘT LỖI PARSE THƯỜNG ═══
 *
 * Nó không làm gì đỏ lên. `push` bỏ qua `null` rồi ném khi KHÔNG còn điểm nào —
 * nhưng bốn số 0 là bốn điểm hợp lệ, nên phép ném không chạy, collector báo
 * thành công, `buildFactSet` trả về một tập fact đầy đủ, và trang dựng xong
 * phục vụ 200. Trên một site dịch vụ chuyển nhà, nó nói "0 người chuyển đến từ
 * hạt khác, 0 từ bang khác" — cạnh giá nhà và thu nhập THẬT của cùng ZIP.
 * Trang toàn số 0 thì người đọc còn nghi; trang có số thật xen số 0 thì đọc như
 * một nơi không ai muốn đến.
 */

/** Census's "can't produce a reliable estimate" sentinel — not a real value. */
export const SUPPRESSED_VALUE = -666666666;

/**
 * Một ô ACS5 → số, hoặc `null` khi ô đó không mang ước lượng.
 *
 * Nhận `unknown` chứ không `string`: phản hồi là JSON, nên ô vắng ước lượng về
 * dưới dạng `null` THẬT, không phải chuỗi "null". Khai kiểu là `string` rồi tin
 * vào nó là cách lỗi này sống sót ba lần viết lại.
 */
export function parseAcsValue(raw: unknown): number | null {
  // Phải đứng TRƯỚC Number(): đây chính là nhánh mà `Number(null) === 0` nuốt.
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;

  const n = Number(raw);
  if (!Number.isFinite(n) || n === SUPPRESSED_VALUE || n < 0) return null;
  return n;
}

export class EmptyUniverseError extends Error {}

/**
 * Vũ trụ của bảng — số người/đơn vị mà mọi ô còn lại là một phần của nó.
 *
 * `null` hoặc `0` nghĩa là KHÔNG CÓ AI để đếm, nên mọi số 0 bên dưới là chỗ
 * trống chứ không phải phép đo. Đo 27/9/2026: ZIP 43218 (Columbus, OH) và 33101
 * (Miami, FL) trả về `0` ở mọi trường — chúng là ZIP hộp thư, Census vẫn phát
 * một hàng ZCTA nhưng không ai ở đó.
 *
 * Tách thành hàm riêng thay vì viết `if` tại chỗ vì ba adapter cần đúng phép
 * này với ba vũ trụ khác nhau (người đã ở đây 1 năm trước, người đi làm, đơn vị
 * nhà có người ở) — và một bản sao thứ tư sẽ lại trôi lệch như `parseAcsValue`
 * đã trôi.
 */
export function assertNonEmptyUniverse(
  total: number | null,
  args: { zip: string; table: string }
): asserts total is number {
  if (total === null || total === 0) {
    throw new EmptyUniverseError(
      `Vũ trụ của ${args.table} bằng ${total === null ? "null" : "0"} cho ZIP ${args.zip} — ` +
        `không có ai để đếm, nên mọi số 0 bên dưới là CHỖ TRỐNG chứ không phải phép đo. ` +
        `Thường là ZIP hộp thư hoặc vùng bảng này không phủ (ví dụ B07003 với Puerto Rico).`
    );
  }
}
