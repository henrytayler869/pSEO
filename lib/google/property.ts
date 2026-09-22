/**
 * Site CHƯA gắn property thì hỏng ở đâu, và hỏng thành câu gì.
 *
 * `Website.gscPropertyUrl` và `ga4PropertyId` là NULLABLE: một site được tạo
 * ở /domains trước khi có ai dựng property cho nó, và thứ tự đó là bình
 * thường. Nhưng mọi hàm gọi Google đều cần một chuỗi property thật.
 *
 * Ném ở ĐẦU hàm gọi Google, thay vì bắt 22 chỗ gọi tự kiểm. Lý do: mọi chỗ
 * gọi đã bọc sẵn lỗi — `logDependencyFailure`, `load(...)`, hoặc
 * `{ ok: false, error }` — và màn hình đã có chỗ hiện câu lỗi đó. Thêm một
 * nhánh `if (!prop)` ở từng chỗ gọi sẽ nhân đôi cùng một quyết định ra 22
 * bản, rồi bản thứ 23 sẽ quên.
 *
 * Khuôn câu lấy từ tiền lệ có sẵn trong kho — `lib/queries/publisher.ts` đã
 * làm đúng thế cho WordPress:
 *
 *     "Site này chưa nối WordPress (wpApiBaseUrl trống)."
 *
 * Câu phải nói CHƯA CẤU HÌNH, không được đọc như một lỗi mạng. "Chưa gắn
 * property" và "gọi Google thất bại" là hai trạng thái khác nhau, và màn
 * hình chỉ phân biệt được nếu câu chữ phân biệt.
 */
export function requireProperty(value: string | null, kind: "gsc" | "ga4"): string {
  if (value) return value;
  throw new Error(
    kind === "gsc"
      ? "Site này chưa gắn property Search Console."
      : "Site này chưa gắn property GA4."
  );
}
