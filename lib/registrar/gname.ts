import { getCredential } from "@/lib/settings/credentials";

/**
 * Đặt nameserver cho một domain tại registrar Gname.
 *
 * Vì sao cần: Cloudflare CẤP nameserver khi tạo zone, và hai địa chỉ đó phải
 * được đặt TẠI REGISTRAR thì domain mới phân giải. Không có bước này, "thêm
 * domain" trong HQ dừng ở nửa việc và người ta vẫn phải mở trang Gname bấm
 * tay — đúng thứ chủ dự án yêu cầu bỏ đi.
 *
 * ═══ HAI ĐIỀU KIỆN, VÀ CHÚNG KHÔNG PHẢI LỖI CODE ═══
 *
 * 1. Gname LỌC THEO IP. Lời gọi phải xuất phát từ máy chủ production
 *    (46.225.145.196); gọi từ máy cá nhân bị từ chối dù key đúng. Nghĩa là
 *    hàm này KHÔNG kiểm thử được ở môi trường phát triển, và mọi lần chạy
 *    thật đầu tiên đều diễn ra trên production.
 *
 * 2. Cần GNAME_API_KEY và GNAME_API_SECRET trong Cài đặt.
 *
 * ═══ CHỖ CÒN THIẾU, NÓI THẲNG ═══
 *
 * `buildSetNameserversRequest` bên dưới CHƯA đúng hợp đồng thật của Gname.
 * Tôi không có tài liệu API của họ, và viết mò hình dạng request là cách tệ
 * nhất có thể ở đây: nó sẽ hỏng trên production, và hỏng theo kiểu trông
 * giống hệt việc bị chặn IP — nên người sửa sẽ đi whitelist IP thêm lần nữa
 * thay vì sửa tham số.
 *
 * Nên chỗ đó được tách ra một hàm riêng, đánh dấu rõ, và `setNameservers`
 * TỪ CHỐI chạy khi nó chưa được điền. Từ chối ồn ào ở đây tốt hơn một request
 * sai bay tới registrar đang giữ domain thật.
 *
 * Cần ba thứ từ tài liệu Gname: URL endpoint, cách ký request bằng secret, và
 * tên tham số cho danh sách nameserver.
 */

export class GnameError extends Error {
  constructor(
    message: string,
    readonly kind: "missing-credentials" | "not-implemented" | "network" | "rejected",
    readonly raw?: string
  ) {
    super(message);
    this.name = "GnameError";
  }
}

export interface GnameCredentials {
  apiKey: string;
  apiSecret: string;
}

export async function getGnameCredentials(): Promise<GnameCredentials | null> {
  const [apiKey, apiSecret] = await Promise.all([
    getCredential("GNAME_API_KEY"),
    getCredential("GNAME_API_SECRET"),
  ]);
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

/**
 * Hợp đồng request — CHƯA ĐIỀN.
 *
 * Trả về null nghĩa là "chưa ai viết phần này". Đừng đoán: xem chú thích đầu
 * file. Khi có tài liệu, điền ở đây và CHỈ ở đây; mọi thứ khác trong file đã
 * sẵn sàng.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- tham số CÓ Ý NGHĨA, chỉ là phần thân chưa viết được vì thiếu tài liệu Gname. Xoá chúng đi sẽ mất luôn hợp đồng mà người điền cần thấy.
export function buildSetNameserversRequest(_params: {
  credentials: GnameCredentials;
  domain: string;
  nameServers: string[];
}): { url: string; init: RequestInit } | null {
  return null;
}

export interface SetNameserversResult {
  ok: boolean;
  detail: string;
}

/**
 * Đặt nameserver. Không ném khi thất bại — trả kết quả có lý do, vì nơi gọi
 * là một hành động trên giao diện và người bấm cần đọc được vì sao.
 */
export async function setNameservers(params: {
  domain: string;
  nameServers: string[];
}): Promise<SetNameserversResult> {
  const { domain, nameServers } = params;

  if (nameServers.length === 0) {
    return {
      ok: false,
      detail: `Domain "${domain}" chưa có nameserver từ Cloudflare. Tạo hoặc nhập zone trước — không có gì để đặt.`,
    };
  }

  const credentials = await getGnameCredentials();
  if (!credentials) {
    return {
      ok: false,
      detail: "Chưa cấu hình GNAME_API_KEY và GNAME_API_SECRET ở trang Cài đặt.",
    };
  }

  const request = buildSetNameserversRequest({ credentials, domain, nameServers });
  if (!request) {
    return {
      ok: false,
      detail:
        "Chưa cài đặt hợp đồng API của Gname — thiếu URL endpoint, cách ký request và tên tham số nameserver. " +
        "Điền ở buildSetNameserversRequest() trong lib/registrar/gname.ts. " +
        "Cố tình KHÔNG đoán: một request sai sẽ hỏng giống hệt việc bị chặn IP, và người sửa sẽ đi whitelist thêm lần nữa thay vì sửa tham số.",
    };
  }

  let res: Response;
  try {
    res = await fetch(request.url, {
      ...request.init,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return {
      ok: false,
      detail:
        `Không gọi được Gname: ${e instanceof Error ? e.message : String(e)}. ` +
        "Nếu lệnh này chạy ngoài máy chủ production thì đây là chuyện BÌNH THƯỜNG — Gname lọc theo IP.",
    };
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, detail: `Gname từ chối (HTTP ${res.status}): ${text.slice(0, 300)}` };
  }

  // 200 chưa đủ. Nhiều API của registrar trả 200 kèm mã lỗi trong thân —
  // cùng hình dạng đã cắn ở lần đẩy khoá sang publisher, nơi một 200 không
  // mang cờ xác nhận là 200 của thứ khác.
  return {
    ok: true,
    detail: `Gname nhận yêu cầu đặt nameserver cho ${domain}: ${nameServers.join(", ")}. Phản hồi: ${text.slice(0, 200)}`,
  };
}
