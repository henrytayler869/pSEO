import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

/**
 * Phép kiểm TĨNH, bổ cho thứ trình biên dịch đã làm.
 *
 * Trình biên dịch ép mọi route phải truyền một phạm vi — quên là lỗi biên
 * dịch. Nhưng nó không phân biệt được phạm vi ĐÚNG với `"no-scope"`, và
 * `"no-scope"` chính là thứ người ta gõ khi muốn cho qua nhanh. Lỗ còn lại
 * là: một route nằm dưới [vertical] nhưng khai không giới hạn — nó sẽ chạy,
 * trả 200, và phục vụ niche của publisher khác.
 *
 * Nên luật ở đây: đường dẫn chứa [vertical] thì PHẢI truyền { vertical }.
 */

const API_DIR = "app/api/v1";

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const files = routeFiles(API_DIR);
const problems: string[] = [];

if (files.length === 0) problems.push(`Không tìm thấy route nào dưới ${API_DIR} — phép kiểm này đang không kiểm gì cả.`);

for (const file of files) {
  const src = readFileSync(file, "utf-8");
  const calls = src.match(/requireApiKey\(\s*request\s*,\s*([^)]+)\)/g) ?? [];

  if (calls.length === 0) {
    problems.push(`${file}: không gọi requireApiKey`);
    continue;
  }

  if (file.includes("[vertical]")) {
    const scoped = calls.some((c) => /\{\s*vertical\s*\}/.test(c));
    if (!scoped) {
      problems.push(`${file}: đường dẫn có [vertical] nhưng không truyền { vertical } — khoá của publisher này đọc được niche của publisher khác`);
    }
  }

  if (file.includes("[host]")) {
    const scoped = calls.some((c) => /host\s*:/.test(c));
    if (!scoped) problems.push(`${file}: đường dẫn có [host] nhưng không giới hạn theo host`);
  }
}

console.log(`Đã soi ${files.length} route dưới ${API_DIR}.`);
for (const f of files) {
  const src = readFileSync(f, "utf-8");
  const m = src.match(/requireApiKey\(\s*request\s*,\s*([^)]+?)\)/);
  console.log(`  ${m ? (m[1].includes("vertical") ? "niche" : m[1].includes("host") ? "host " : "MỞ  ") : "??? "}  ${f}`);
}

if (problems.length) {
  console.log(`\n✗ ${problems.length} vấn đề:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("\n✓ mọi route dưới [vertical] đều giới hạn theo niche.");
