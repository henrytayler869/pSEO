/**
 * Tách tham số vị trí khỏi cờ, cho script chạy tay.
 *
 * Sinh ra sau một lỗi đo được: `generate-cluster-text.ts` đọc số lượng bằng
 * `Number(process.argv[2])`. Thêm `--site` vào là argv[2] thành chuỗi
 * "--site", `Number()` cho `NaN`, và `slice(0, NaN)` cho mảng rỗng — script
 * in "31 cụm", không báo lỗi nào, và sinh ĐÚNG 0 đoạn. Người chạy đọc dòng
 * "31 cụm" rồi tin là xong.
 *
 * Đây là lý do NaN ở đây phải ném lỗi chứ không rơi về mặc định: một số
 * không đọc được là người dùng gõ sai, và im lặng chạy với giá trị khác
 * biến câu lệnh của họ thành một câu lệnh khác.
 */

/**
 * Cờ có nhận GIÁ TRỊ theo sau — giá trị đó không phải tham số vị trí.
 *
 * DANH SÁCH NÀY PHẢI ĐẦY ĐỦ, và quên một cờ thì hỏng IM LẶNG. Đo 25/9/2026:
 * `issue-publisher-key.ts` thêm `--via <id site>` mà không thêm vào đây, nên
 * `positionals()[0]` trả về ID của site trung chuyển thay vì nhãn người gõ —
 * và khoá được cấp với nhãn `cmtshrs8p00016xql1gyqmrof`. Không lỗi nào; chỉ
 * một hàng trong bảng mang nhãn vô nghĩa, phát hiện khi có người đọc bảng.
 *
 * `scripts/test-argv.ts` quét mọi script dùng `positionals()` và đòi mọi cờ
 * ĐỌC GIÁ TRỊ trong đó phải có mặt ở đây — vì lần sau người thêm cờ cũng sẽ
 * không nghĩ tới file này.
 */
export const VALUE_FLAGS = new Set(["--site", "--file", "--via"]);

export function positionals(argv: string[] = process.argv): string[] {
  const out: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (VALUE_FLAGS.has(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

export class BadArgError extends Error {}

/**
 * Đọc tham số vị trí thứ `index` thành số.
 *
 * Vắng mặt → `fallback`. Có mặt nhưng không phải số → ném `BadArgError`.
 * Hai trường hợp đó khác nhau và phải xử lý khác nhau.
 */
export function numberArg(index: number, fallback: number, argv: string[] = process.argv): number {
  const raw = positionals(argv)[index];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new BadArgError(`Tham số "${raw}" không phải số. Cờ phải đi kèm giá trị, ví dụ: --site atmovingservices.com 10`);
  }
  return n;
}

/** In lỗi tham số cho gọn rồi thoát 1. */
export function reportArgError(err: unknown): boolean {
  if (!(err instanceof BadArgError)) return false;
  console.error(err.message);
  process.exitCode = 1;
  return true;
}
