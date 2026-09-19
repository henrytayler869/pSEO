import { getCredential } from "@/lib/settings/credentials";

/**
 * Đặt mật khẩu mới cho tài khoản quản trị WordPress của một publisher.
 *
 * Đi qua route riêng của mu-plugin (`atms/v1/admin-password`), KHÔNG qua REST
 * chuẩn của WordPress. Lý do đã đo, không phải phỏng đoán: Application
 * Password không sửa được user.
 *
 *   admin app-password đổi mật khẩu CHÍNH NÓ    -> 401 rest_cannot_edit
 *   admin app-password đổi mật khẩu user KHÁC   -> 401 rest_cannot_edit
 *
 * (Đo 19/9/2026 trên WordPress 6 của publisher thứ hai, bằng một tài khoản
 * admin tạm rồi xoá đi.)
 *
 * KHÔNG CÓ HÀM ĐỌC MẬT KHẨU HIỆN TẠI, và sẽ không có. WordPress lưu hash;
 * không nơi nào giữ bản rõ. Muốn "xem mật khẩu" thì Head Quarter phải tự lưu
 * bản rõ của mọi publisher — biến CSDL này thành nơi một lần rò rỉ mở được
 * mọi wp-admin. Đổi sang mật khẩu mới rồi hiện MỘT LẦN giải đúng nhu cầu
 * (vào được wp-admin) mà không tạo ra kho đó.
 */

export class WpAdminPasswordError extends Error {}

/** Độ dài tối thiểu. Route phía WordPress kiểm lại con số này — một phép kiểm
 *  chỉ sống ở phía gọi là phép kiểm mà lời gọi thứ hai bỏ qua được. */
export const MIN_PASSWORD_LENGTH = 16;

/**
 * Mật khẩu sinh máy, cho lần đặt lại.
 *
 * base64url của 24 byte ngẫu nhiên: không dấu cách, không ký tự mà shell hay
 * URL phải thoát, và không ký tự dễ đọc nhầm khi chép tay hỏng.
 */
export function generatePassword(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24)))
    .toString("base64url")
    .slice(0, 32);
}

export async function setWordPressAdminPassword(params: {
  wpApiBaseUrl: string;
  username: string;
  password: string;
  loopbackSecret: string | null;
}): Promise<void> {
  const { wpApiBaseUrl, username, password, loopbackSecret } = params;

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WpAdminPasswordError(`Mật khẩu phải dài ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`);
  }

  const secret = loopbackSecret ?? (await getCredential("WP_LOOPBACK_SECRET"));
  if (!secret) {
    throw new WpAdminPasswordError(
      "Chưa có loopback secret cho site này. Nó phải khớp ATMS_LOOPBACK_SECRET trong " +
        "deploy/wordpress/.env.<host> của publisher — route sẽ trả 404 nếu không khớp."
    );
  }

  // Cắt `/wp/v2` để về gốc REST, rồi gắn namespace của mu-plugin. Cắt theo
  // `/wp-json` chứ không cắt số đoạn cố định, vì vài cài đặt proxy REST ở độ
  // sâu namespace khác.
  const root = wpApiBaseUrl.replace(/\/wp-json(\/.*)?$/, "").replace(/\/+$/, "");
  const url = `${root}/wp-json/atms/v1/admin-password`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Header này là toàn bộ phần "chứng minh mình là HQ". Không có nó,
        // route trả 404 như chưa từng tồn tại.
        "x-atms-loopback": secret,
      },
      body: JSON.stringify({ user: username, password }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new WpAdminPasswordError(
      `Không gọi được WordPress tại ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (res.status === 404) {
    // 404 ở đây có HAI nghĩa và người đọc cần biết cả hai, vì route cố tình
    // ẩn mình khi phép kiểm trượt.
    throw new WpAdminPasswordError(
      "WordPress trả 404. Hoặc mu-plugin đổi mật khẩu chưa được nạp, hoặc loopback secret không khớp " +
        "— route ẩn mình khi phép kiểm trượt, nên hai trường hợp đó trông giống nhau từ đây."
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new WpAdminPasswordError(`WordPress trả HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}
