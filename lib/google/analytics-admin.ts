import { getGoogleAccessToken } from "@/lib/google/service-account";

/**
 * Tạo GA4 property và luồng dữ liệu web cho một site mới.
 *
 * Vì sao cần: nối một publisher vào HQ đòi `ga4PropertyId` — cột NOT NULL,
 * phải là dãy số thật. Trước đây chủ dự án phải tự vào Google Analytics tạo
 * property rồi chép số về, và đó là bước chặn duy nhất còn lại của publisher
 * thứ hai suốt nhiều ngày.
 *
 * HAI ID, KHÔNG PHẢI MỘT, và chúng không suy ra được từ nhau:
 *
 *   ga4PropertyId     dãy số, ví dụ 553102895 — dùng ĐỌC báo cáo qua Data API
 *   ga4MeasurementId  G-XXXXXXXXXX            — dùng GHI sự kiện từ trang web
 *
 * Property đẻ ra cái thứ nhất; phải tạo thêm một Web Data Stream mới có cái
 * thứ hai. Tạo property rồi dừng sẽ để lại một site đọc được báo cáo rỗng
 * vĩnh viễn, vì không trang nào gửi sự kiện.
 *
 * CHƯA CHẠY ĐƯỢC THẬT khi viết file này: Analytics Admin API chưa bật trong
 * project Google Cloud 441097379236 (đo 16/9/2026, GET /v1beta/accounts trả
 * 403 kèm đúng câu đó). Token cho scope analytics.edit thì lấy được — nên
 * scope KHÔNG phải chỗ nghẽn. Mọi thông báo lỗi dưới đây nêu thẳng hai điều
 * kiện, vì đó là hai thứ người bấm nút sẽ vấp.
 */

const SCOPE = "https://www.googleapis.com/auth/analytics.edit";
const BASE = "https://analyticsadmin.googleapis.com/v1beta";

export class AnalyticsAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Thông báo thô của Google, giữ nguyên. Diễn giải lại lỗi của bên thứ ba
     *  là cách một nguyên nhân thật bị thay bằng một phỏng đoán. */
    readonly raw?: string
  ) {
    super(message);
    this.name = "AnalyticsAdminError";
  }
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const token = await getGoogleAccessToken([SCOPE]);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  if (res.ok) return text ? JSON.parse(text) : {};

  let detail = text.slice(0, 400);
  try {
    detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? detail;
  } catch {
    // giữ nguyên text
  }

  // Hai lỗi này có cách sửa hoàn toàn khác nhau, và cả hai đều trả 403.
  // Gộp chúng thành "không có quyền" sẽ gửi người ta đi sửa nhầm chỗ.
  if (/has not been used in project|is disabled/i.test(detail)) {
    throw new AnalyticsAdminError(
      "Analytics Admin API chưa bật trong project Google Cloud. Bật ở console.developers.google.com " +
        "→ APIs & Services → Enable APIs → Google Analytics Admin API, rồi thử lại sau vài phút.",
      res.status,
      detail
    );
  }
  if (res.status === 403) {
    throw new AnalyticsAdminError(
      "Service Account chưa được cấp quyền trên tài khoản Google Analytics. Vào GA4 → Admin → " +
        "Account access management, thêm email của Service Account với vai trò Editor trở lên. " +
        "Quyền phải ở cấp TÀI KHOẢN, không phải cấp property — property chưa tồn tại thì không cấp ở đó được.",
      res.status,
      detail
    );
  }
  throw new AnalyticsAdminError(`Analytics Admin API trả ${res.status}: ${detail}`, res.status, detail);
}

export interface GaAccount {
  /** Dạng "accounts/123456". */
  name: string;
  displayName: string;
}

export async function listAccounts(): Promise<GaAccount[]> {
  const json = (await call("/accounts")) as { accounts?: GaAccount[] };
  return json.accounts ?? [];
}

export interface CreatedProperty {
  /** Dãy số — đây là thứ Website.ga4PropertyId cần. */
  propertyId: string;
  /** G-XXXXXXXXXX — đây là thứ Website.ga4MeasurementId cần. */
  measurementId: string;
  displayName: string;
}

/**
 * Tạo property + luồng web, trả về CẢ HAI id.
 *
 * `siteUrl` phải là origin đầy đủ; GA4 dùng nó làm defaultUri của luồng, và
 * một defaultUri sai làm báo cáo gán sai domain — thứ không ai nhìn ra cho
 * tới khi so số với Search Console.
 */
export async function createPropertyWithWebStream(params: {
  accountName: string;
  displayName: string;
  siteUrl: string;
  timeZone?: string;
  currencyCode?: string;
}): Promise<CreatedProperty> {
  const { accountName, displayName, siteUrl } = params;

  const property = (await call("/properties", {
    method: "POST",
    body: JSON.stringify({
      parent: accountName,
      displayName,
      // Múi giờ và tiền tệ mặc định theo thị trường mà mọi site hiện tại nhắm
      // tới. Sai múi giờ chỉ lệch ranh giới ngày trong báo cáo, không mất dữ
      // liệu — nên mặc định được, khác với defaultUri.
      timeZone: params.timeZone ?? "America/Los_Angeles",
      currencyCode: params.currencyCode ?? "USD",
    }),
  })) as { name?: string; displayName?: string };

  // "properties/553102895" → "553102895". Website.ga4PropertyId lưu phần số,
  // và assertValidGa4PropertyId từ chối chuỗi còn tiền tố.
  const propertyId = String(property.name ?? "").replace(/^properties\//, "");
  if (!/^\d+$/.test(propertyId)) {
    throw new AnalyticsAdminError(
      `Google trả về tên property không đọc được: ${JSON.stringify(property.name)}`,
      200
    );
  }

  const stream = (await call(`/properties/${propertyId}/dataStreams`, {
    method: "POST",
    body: JSON.stringify({
      type: "WEB_DATA_STREAM",
      displayName: `${displayName} — web`,
      webStreamData: { defaultUri: siteUrl.replace(/\/+$/, "") },
    }),
  })) as { webStreamData?: { measurementId?: string } };

  const measurementId = stream.webStreamData?.measurementId ?? "";
  if (!/^G-/.test(measurementId)) {
    // Property ĐÃ tạo xong ở đây. Nói rõ điều đó thay vì để người ta bấm lại
    // và đẻ ra property thứ hai trùng tên.
    throw new AnalyticsAdminError(
      `Đã tạo property ${propertyId} nhưng luồng web không trả về measurement ID. ` +
        `ĐỪNG bấm lại — vào GA4 → Admin → Data streams của property ${propertyId} để lấy hoặc tạo luồng.`,
      200
    );
  }

  return { propertyId, measurementId, displayName: property.displayName ?? displayName };
}
