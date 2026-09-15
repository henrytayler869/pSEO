import { inflateRawSync } from "node:zlib";

/**
 * Đọc MỘT entry ra khỏi một file ZIP trong bộ nhớ.
 *
 * Vì sao tự viết thay vì thêm phụ thuộc: repo chưa có thư viện zip nào, và
 * thứ cần ở đây là một entry từ một file có cấu trúc cố định do NHTSA phát
 * hành mỗi năm. Thêm một gói npm cho việc đó là mở rộng bề mặt phụ thuộc
 * cho một lần dùng.
 *
 * Chỉ hỗ trợ hai phương thức nén ZIP quy định: 0 (store) và 8 (deflate).
 * Gặp phương thức khác thì NÉM, không đoán — một file giải nén sai cho ra
 * bytes rác, và bytes rác đi qua CSV parser sẽ thành "0 hàng" chứ không
 * thành lỗi.
 */

export class ZipReadError extends Error {}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

/** Trả về nội dung entry đầu tiên có tên KẾT THÚC bằng `suffix`. */
export function readZipEntry(zip: Buffer, suffix: string): Buffer {
  // End of Central Directory nằm ở cuối file, sau một comment dài tối đa
  // 65.535 byte — nên quét ngược từ cuối thay vì đọc ở một offset cố định.
  let eocd = -1;
  const from = Math.max(0, zip.length - 65_557);
  for (let i = zip.length - 22; i >= from; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipReadError("Không tìm thấy End of Central Directory — file không phải ZIP hợp lệ hoặc bị cắt.");

  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== CEN_SIG) throw new ZipReadError(`Mục central directory thứ ${i} sai chữ ký.`);
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOff = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf-8", p + 46, p + 46 + nameLen);

    if (name.endsWith(suffix)) {
      // Local header có độ dài name/extra RIÊNG, thường khác central
      // directory. Dùng nhầm số của central là lệch offset vài byte và ra
      // dữ liệu rác — nên đọc lại từ local header.
      const lNameLen = zip.readUInt16LE(localOff + 26);
      const lExtraLen = zip.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = zip.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) return inflateRawSync(raw);
      throw new ZipReadError(`Entry "${name}" dùng phương thức nén ${method}; chỉ hỗ trợ 0 (store) và 8 (deflate).`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new ZipReadError(`Không có entry nào kết thúc bằng "${suffix}" trong ZIP (${count} entry).`);
}
