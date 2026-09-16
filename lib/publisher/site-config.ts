/**
 * Hợp đồng cấu hình mà một app đa-tenant đọc để biết nó đang phục vụ site nào.
 *
 * Vì sao tồn tại: mô hình đã đổi từ "mỗi publisher một bản build" sang "một
 * app phục vụ nhiều domain, phân biệt theo Host". Hằng số `SITE` trong mã
 * nguồn publisher chỉ đúng ở mô hình cũ; ở mô hình mới nó sẽ gán danh tính
 * của site này cho mọi site khác — và trang vẫn render đủ, vẫn 200, chỉ sai
 * thương hiệu và sai mã analytics. Không có gì đỏ.
 *
 * Phần quyết định của file này là `judgeReadiness`: nó tách "site này chưa
 * đủ để dựng" khỏi "site này không tồn tại". Hai câu đó dẫn tới hai hành
 * động khác nhau, và gộp chúng vào một lỗi 404 là cách một người đi sửa DNS
 * cho một vấn đề nằm ở ô nhập liệu.
 */

export interface SiteIdentityRow {
  id: string;
  name: string;
  url: string;
  vertical: string;
  tagline: string | null;
  description: string | null;
  ga4MeasurementId: string | null;
  wpApiBaseUrl: string | null;
}

/**
 * Trường nào BẮT BUỘC phải có thì site mới dựng được, và vì sao.
 *
 * Danh sách này là thứ nút "Dựng Site" hỏi trước khi làm bất cứ gì. Không có
 * nó thì nút sẽ dựng ra một site render đủ nhưng rỗng danh tính, và lỗi đó
 * chỉ lộ ra khi ai đó nhìn kết quả tìm kiếm vài tuần sau.
 */
export const REQUIRED_FOR_BUILD: { field: keyof SiteIdentityRow; why: string }[] = [
  { field: "name", why: "hiện ở tiêu đề trang và tên thương hiệu" },
  { field: "url", why: "gốc của mọi URL tuyệt đối, canonical và sitemap" },
  { field: "vertical", why: "quyết định đọc niche nào từ HQ; sai là site trống trơn" },
  { field: "tagline", why: "dòng dưới tên site; thiếu thì trang chủ không nói site này làm gì" },
  { field: "description", why: "thẻ meta description; thiếu là ship một thẻ RỖNG, hỏng SEO không ai thấy" },
];

export interface Readiness {
  ready: boolean;
  /** Tên trường còn thiếu, kèm lý do — để thông báo nói được phải điền gì. */
  missing: { field: string; why: string }[];
}

/** Thuần: hàng này đã đủ để dựng site chưa. */
export function judgeReadiness(row: SiteIdentityRow): Readiness {
  const missing = REQUIRED_FOR_BUILD.filter(({ field }) => {
    const v = row[field];
    return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  }).map(({ field, why }) => ({ field: String(field), why }));
  return { ready: missing.length === 0, missing };
}

export interface SiteConfigResponse {
  websiteId: string;
  host: string;
  name: string;
  url: string;
  vertical: string;
  tagline: string | null;
  description: string | null;
  /** null là câu trả lời THẬT nghĩa là "chưa cấu hình analytics", khác hẳn
   * 404 nghĩa là "host này chưa đăng ký". Gộp hai cái sẽ khiến một caller
   * lặng lẽ bỏ thẻ analytics mỗi khi host bị gõ sai. */
  ga4MeasurementId: string | null;
  wpApiBaseUrl: string | null;
  ready: boolean;
  missing: { field: string; why: string }[];
}

export function buildSiteConfig(row: SiteIdentityRow, host: string): SiteConfigResponse {
  const { ready, missing } = judgeReadiness(row);
  return {
    websiteId: row.id,
    host,
    name: row.name,
    url: row.url.replace(/\/+$/, ""),
    vertical: row.vertical,
    tagline: row.tagline,
    description: row.description,
    ga4MeasurementId: row.ga4MeasurementId,
    wpApiBaseUrl: row.wpApiBaseUrl,
    // Trả cấu hình KÈM phán quyết, không phải từ chối trả.
    //
    // App đa-tenant vẫn cần dựng được trang cho một site thiếu tagline — chặn
    // hẳn ở đây là biến một ô nhập bỏ trống thành một site sập. Thứ phải chặn
    // là hành động DỰNG MỚI, và nó chặn bằng cờ này.
    ready,
    missing,
  };
}
