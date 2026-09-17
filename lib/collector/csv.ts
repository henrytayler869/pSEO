/**
 * Bộ đọc CSV theo RFC 4180 — trường có ngoặc kép, dấu phẩy bên trong, và
 * ngoặc kép lồng (`""`).
 *
 * ═══ VÌ SAO TỒN TẠI ═══
 *
 * Hai adapter tách CSV bằng `line.split(",")`. Với FARS 2022 điều đó làm số
 * người chết CAO GẦN GẤP ĐÔI sự thật. Đo trên chính file của NHTSA, 17/9/2026:
 *
 *   FATALS là cột thứ 79 / 80        ← gần cuối, nên mọi lệch cột đều trúng nó
 *   dòng có dấu ngoặc kép   1.107 / 39.422
 *
 *   NGÂY THƠ     vụ=38.878  người=80.360  tỷ lệ 2,07
 *   ĐÚNG CHUẨN   vụ=39.419  người=42.718  tỷ lệ 1,08
 *   NHTSA công bố          39.221 vụ · 42.795 người · tỷ lệ 1,09
 *
 * Hai điều đáng ghi:
 *
 * 1. Lỗi KHÔNG tỷ lệ với số dòng hỏng. 1.107 dòng trên 39.422 là 2,8%, nhưng
 *    sai số ở tổng là +88% — vì khi cột lệch, `FATALS` đọc trúng một cột khác
 *    có giá trị lớn hơn nhiều. Một lỗi phân tích cú pháp không "hỏng một
 *    chút"; nó đọc một con số khác hẳn và trả về nó với vẻ hoàn toàn bình
 *    thường.
 *
 * 2. Nó cũng nuốt 541 VỤ: những dòng lệch nặng tới mức STATE/COUNTY không
 *    parse được thì bị bỏ qua hẳn. Mất mát im lặng, ở một nguồn mà "hạt không
 *    có trong file" được hiểu là "hạt không có vụ nào".
 *
 * Không dùng thư viện ngoài: repo này theo quy ước không-SDK cho mọi nguồn dữ
 * liệu, và phần cần dùng của RFC 4180 vừa đúng hàm dưới đây.
 */

/**
 * Tách MỘT file CSV thành mảng hàng, mỗi hàng là mảng trường.
 *
 * Xử lý xuống dòng BÊN TRONG trường có ngoặc kép — đó là lý do hàm này quét
 * cả văn bản thay vì tách dòng trước rồi tách trường sau. Tách dòng trước là
 * chính cái giả định đã hỏng ở FARS: một trường có ngoặc kép chứa xuống dòng
 * sẽ thành hai hàng rác.
 *
 * Bỏ BOM UTF-8 ở đầu: đọc sai nó khiến cột đầu mang tên "﻿STATE", và
 * `indexOf("STATE")` trả -1 — lỗi đã mắc một lần với chính adapter FARS.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyChar = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        // `""` bên trong trường có ngoặc kép là MỘT dấu ngoặc kép, không phải
        // kết thúc trường.
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      sawAnyChar = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      sawAnyChar = true;
    } else if (ch === "\n" || ch === "\r") {
      // CRLF: bỏ qua \n ngay sau \r thay vì sinh một hàng rỗng.
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      // Hàng rỗng (chỉ có xuống dòng) bị bỏ, giống hành vi cũ `.filter(l => l.trim())`.
      if (sawAnyChar || row.some((f) => f.length > 0)) rows.push(row);
      row = [];
      sawAnyChar = false;
    } else {
      field += ch;
      sawAnyChar = true;
    }
  }

  if (sawAnyChar || field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.length > 0)) rows.push(row);
  }

  return rows;
}

/**
 * Chỉ số cột theo tên, hoặc -1.
 *
 * Trim từng ô tiêu đề: file thật có khoảng trắng thừa, và một tiêu đề lệch một
 * dấu cách làm cả adapter đọc sai cột mà không có gì kêu.
 */
export function headerIndex(header: string[], name: string): number {
  return header.findIndex((h) => h.trim() === name);
}
