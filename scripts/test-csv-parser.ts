import { parseCsv, headerIndex } from "@/lib/collector/csv";

/**
 * Chạy: npx tsx scripts/test-csv-parser.ts
 *
 * Mỗi ca dưới đây là một hình dạng ĐÃ làm hỏng dữ liệu thật, không phải một
 * bài tập về RFC 4180. Ca quan trọng nhất là ca đầu: nó tái hiện đúng cách
 * FARS 2022 bị đọc sai — và nó chứng minh rằng cột cuối, chứ không phải cột
 * gần chỗ có dấu phẩy, mới là cột nhận hậu quả.
 */

let pass = 0;
const fail: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

// 1. Dấu phẩy trong trường có ngoặc kép — hình dạng của FARS.
{
  const rows = parseCsv('STATE,TWAY_ID,FATALS\n1,"I-65, NB",2\n');
  check("dấu phẩy trong ngoặc kép không tách cột", rows[1].length === 3, `thấy ${rows[1].length} cột`);
  check(
    "CỘT CUỐI vẫn đúng — đây là cả vấn đề",
    rows[1][2] === "2",
    `thấy "${rows[1][2]}"; split(",") trần trả về "NB\\" và tổng sai 88%`
  );
}

// 2. Ngoặc kép lồng.
{
  const rows = parseCsv('a,b\n"nói ""xin chào""",2\n');
  check("ngoặc kép lồng thành một dấu", rows[1][0] === 'nói "xin chào"', rows[1][0]);
}

// 3. Xuống dòng BÊN TRONG trường có ngoặc kép.
{
  const rows = parseCsv('a,b\n"dòng một\ndòng hai",2\n');
  check("xuống dòng trong ngoặc kép KHÔNG tạo hàng mới", rows.length === 2, `thấy ${rows.length} hàng`);
  check("và giữ nguyên nội dung", rows[1][0] === "dòng một\ndòng hai");
}

// 4. CRLF — file của cơ quan liên bang gần như luôn là CRLF.
{
  const rows = parseCsv("a,b\r\n1,2\r\n");
  check("CRLF không sinh hàng rỗng", rows.length === 2, `thấy ${rows.length}`);
  check("và không để sót \\r ở ô cuối", rows[1][1] === "2", JSON.stringify(rows[1][1]));
}

// 5. BOM.
{
  const rows = parseCsv("\uFEFFSTATE,COUNTY\n1,2\n");
  check("BOM bị bỏ, cột đầu tra được", headerIndex(rows[0], "STATE") === 0, JSON.stringify(rows[0][0]));
}

// 6. Ô rỗng ở cuối hàng — mất nó làm mọi cột sau đó lệch.
{
  const rows = parseCsv("a,b,c\n1,,3\n");
  check("ô rỗng giữ chỗ", rows[1].length === 3 && rows[1][1] === "", JSON.stringify(rows[1]));
}

// 7. Dòng cuối không có ký tự xuống dòng.
{
  const rows = parseCsv("a,b\n1,2");
  check("hàng cuối không có \\n vẫn được đọc", rows.length === 2 && rows[1][1] === "2");
}

// 8. Tiêu đề có khoảng trắng thừa.
{
  const rows = parseCsv("STATE , COUNTY\n1,2\n");
  check("headerIndex trim tiêu đề", headerIndex(rows[0], "COUNTY") === 1);
}

console.log(fail.length ? `✗ ${fail.length} trượt:\n  ${fail.join("\n  ")}\n` : "");
console.log(`${pass}/${pass + fail.length} đạt.`);
process.exit(fail.length ? 1 : 0);
