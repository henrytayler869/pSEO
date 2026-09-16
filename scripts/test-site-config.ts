import { judgeReadiness, buildSiteConfig, REQUIRED_FOR_BUILD, type SiteIdentityRow } from "@/lib/publisher/site-config";

let pass = 0;
const fail: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const full: SiteIdentityRow = {
  id: "w1",
  name: "AT Moving Services",
  url: "https://atmovingservices.com/",
  vertical: "moving-services",
  tagline: "Federal moving and housing data, ZIP by ZIP",
  description: "Household migration counts from IRS return data…",
  ga4MeasurementId: "G-ABC123",
  wpApiBaseUrl: "https://atmovingservices.com/wp-json/wp/v2",
};

// ---- đủ / thiếu ----
check("hàng đủ trường → ready", judgeReadiness(full).ready);
check("hàng đủ trường → không thiếu gì", judgeReadiness(full).missing.length === 0);

for (const { field } of REQUIRED_FOR_BUILD) {
  const row = { ...full, [field]: null } as SiteIdentityRow;
  const v = judgeReadiness(row);
  check(`thiếu ${String(field)} → KHÔNG ready`, !v.ready);
  check(`thiếu ${String(field)} → nêu đúng tên trường`, v.missing.some((m) => m.field === String(field)));
  check(`thiếu ${String(field)} → kèm lý do, không phải tên trống`, (v.missing.find((m) => m.field === String(field))?.why ?? "").length > 10);
}

// ---- chuỗi rỗng và khoảng trắng KHÔNG được tính là đã điền ----
check(
  "description chỉ có khoảng trắng → KHÔNG ready",
  !judgeReadiness({ ...full, description: "   " }).ready,
  "một thẻ meta chứa toàn khoảng trắng rỗng y như thẻ không có"
);
check("tagline chuỗi rỗng → KHÔNG ready", !judgeReadiness({ ...full, tagline: "" }).ready);

// ---- ga4 và wp KHÔNG bắt buộc ----
check(
  "thiếu ga4MeasurementId vẫn ready",
  judgeReadiness({ ...full, ga4MeasurementId: null }).ready,
  "site dựng được trước khi có analytics; bắt buộc nó là bịa ra một phụ thuộc không tồn tại"
);
check("thiếu wpApiBaseUrl vẫn ready", judgeReadiness({ ...full, wpApiBaseUrl: null }).ready);

// ---- hình dạng phản hồi ----
const cfg = buildSiteConfig(full, "atmovingservices.com");
check("url bị cắt dấu / ở cuối", cfg.url === "https://atmovingservices.com", cfg.url);
check("host trả về đúng host đã hỏi", cfg.host === "atmovingservices.com");
check("mang theo vertical", cfg.vertical === "moving-services");
check("mang theo websiteId", cfg.websiteId === "w1");
check("ready đi kèm cấu hình, không thay thế nó", cfg.ready === true && cfg.name === full.name);

const partial = buildSiteConfig({ ...full, description: null }, "atmovingservices.com");
check(
  "site thiếu trường VẪN nhận được cấu hình",
  partial.name === full.name && partial.vertical === full.vertical,
  "chặn hẳn ở đây là biến một ô bỏ trống thành một site sập"
);
check("nhưng ready=false", !partial.ready);

console.log(fail.length ? `\n✗ ${fail.length} trượt:\n  ${fail.join("\n  ")}\n` : "");
console.log(`${pass}/${pass + fail.length} đạt.`);
process.exit(fail.length ? 1 : 0);
