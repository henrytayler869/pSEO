import crypto from "crypto";

/**
 * Lõi thuần của khoá API theo publisher. Không chạm Prisma, không chạm
 * process.env — để kiểm được toàn bộ mà không cần database.
 */

export const KEY_PREFIX = "pseo_";

/** Số byte ngẫu nhiên trong khoá. 24 byte = 192 bit, giữ nguyên độ dài của
 * khoá dùng chung cũ để không có publisher nào nghĩ khoá mới yếu hơn. */
const SECRET_BYTES = 24;

/**
 * Phần đầu khoá được lưu NGUYÊN VĂN để tra cứu và để hiển thị.
 *
 * Vì sao cần: khoá lưu dưới dạng băm, nên không thể tra bằng chính khoá.
 * Không có prefix thì `verify` phải đọc MỌI hàng rồi so từng cái — O(n) mỗi
 * request, và tệ hơn là nó biến số khoá đang tồn tại thành thứ đo được qua
 * thời gian phản hồi.
 *
 * `pseo_` + 8 ký tự hex. Đây KHÔNG phải bí mật: nó là thứ hiện trên màn hình
 * khi người ta cần biết "khoá nào đang dùng", và 8 hex không đủ để đoán 24
 * byte còn lại.
 */
export const PREFIX_LEN = KEY_PREFIX.length + 8;

export type MintedKey = {
  /** Giá trị đầy đủ. Chỉ tồn tại ĐÚNG MỘT LẦN, trong tiến trình đã sinh ra
   * nó. Không ghi xuống đâu cả ngoài chỗ người dùng tự copy. */
  key: string;
  keyPrefix: string;
  keyHash: string;
};

export function mintKey(): MintedKey {
  const key = KEY_PREFIX + crypto.randomBytes(SECRET_BYTES).toString("hex");
  return { key, keyPrefix: key.slice(0, PREFIX_LEN), keyHash: hashKey(key) };
}

/**
 * SHA-256, KHÔNG phải bcrypt/argon2, và đây là lựa chọn có chủ ý.
 *
 * Băm chậm tồn tại để chống dò từ điển trên mật khẩu do người đặt — thứ có
 * entropy thấp. Khoá này có 192 bit ngẫu nhiên từ CSPRNG; không có từ điển
 * nào dò được, nên chi phí của băm chậm rơi hết vào ĐƯỜNG ĐI THẬT (mọi
 * request của publisher) mà không mua thêm gì.
 *
 * Thứ băm ở đây thật sự mua được: một người đọc được database HQ vẫn không
 * lấy được khoá để gọi API. Trước thay đổi này, khoá nằm nguyên văn trong
 * AppConfig.
 */
export function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

/** Trả về prefix để tra cứu, hoặc null nếu chuỗi không thể là khoá của ta.
 * Loại sớm ở đây để một header rác không thành một lượt truy vấn database. */
export function prefixOf(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  if (!candidate.startsWith(KEY_PREFIX)) return null;
  if (candidate.length !== KEY_PREFIX.length + SECRET_BYTES * 2) return null;
  return candidate.slice(0, PREFIX_LEN);
}

/** So sánh hằng thời gian trên hai chuỗi băm hex. */
export function hashesMatch(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Publisher nào được phép đọc gì.
 *
 * `null` website = khoá KHÔNG giới hạn — chỉ có một hàng như vậy, là khoá
 * dùng chung cũ còn sống để site đầu không chết giữa lúc chuyển. Nó phải
 * hiện ra là một ngoại lệ đang đếm ngược, không phải một hạng công dân.
 */
export type ApiCaller = {
  keyId: string;
  websiteId: string | null;
  websiteName: string | null;
  vertical: string | null;
};

/**
 * Phạm vi mà một route đòi hỏi. THAM SỐ BẮT BUỘC của requireApiKey.
 *
 * Bắt buộc chứ không phải tuỳ chọn, vì kiểu bỏ sót nguy hiểm nhất ở đây là
 * im lặng: một route mới quên truyền phạm vi sẽ phục vụ dữ liệu của mọi
 * niche cho mọi khoá, và không có gì đỏ. Để nó bắt buộc thì quên = lỗi biên
 * dịch. "no-scope" là cách nói KHÔNG giới hạn một cách để người đọc thấy
 * được, không phải mặc định lặng lẽ.
 */
export type ApiScope = { vertical: string } | { host: string } | "no-scope";

export type ScopeVerdict = { ok: true } | { ok: false; reason: string };

/** Thuần: khoá này có được đọc thứ route đang phục vụ không. */
export function judgeScope(caller: ApiCaller, scope: ApiScope, hostMatches?: boolean): ScopeVerdict {
  if (scope === "no-scope") return { ok: true };

  // Khoá dùng chung cũ đọc được mọi thứ — đó chính là lý do nó phải biến mất.
  if (caller.websiteId === null) return { ok: true };

  if ("vertical" in scope) {
    return caller.vertical === scope.vertical
      ? { ok: true }
      : {
          ok: false,
          reason:
            `Khoá này thuộc publisher "${caller.websiteName}" (niche "${caller.vertical}") ` +
            `nên không đọc được niche "${scope.vertical}".`,
        };
  }

  // Phạm vi theo host không tự đối chiếu được ở đây: nó cần chuẩn hoá host
  // của website, mà chuẩn hoá lại nằm ở lớp gọi. Người gọi truyền kết quả
  // vào; undefined là chưa đối chiếu, và chưa đối chiếu thì TỪ CHỐI.
  return hostMatches === true
    ? { ok: true }
    : {
        ok: false,
        reason: `Khoá này thuộc publisher "${caller.websiteName}" nên không đọc được cấu hình của host "${scope.host}".`,
      };
}
