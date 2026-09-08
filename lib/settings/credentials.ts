import { prisma } from "@/lib/db/prisma";

const CONFIG_KEY = "credentials";

export interface CredentialField {
  name: string;
  label: string;
  group: string;
  secret: boolean; // secret fields are masked in the UI and never echoed back in full
  helpText?: string;
}

/** Every credential the Settings page can manage, grouped by the module
 * that consumes it. Adding a new external API means adding one entry here
 * plus wiring the relevant resolve*() function to call getCredential(). */
export const CREDENTIAL_FIELDS: CredentialField[] = [
  {
    name: "DATAFORSEO_LOGIN",
    label: "DataForSEO — Login",
    group: "Thị trường (số liệu từ khóa)",
    secret: false,
    helpText: "Email đăng nhập tài khoản DataForSEO của bạn.",
  },
  {
    name: "DATAFORSEO_PASSWORD",
    label: "DataForSEO — API Password",
    group: "Thị trường (số liệu từ khóa)",
    secret: true,
    helpText: "Lấy tại app.dataforseo.com/api-access — khác mật khẩu đăng nhập dashboard.",
  },
  {
    name: "CENSUS_API_KEY",
    label: "Census Bureau API Key",
    group: "Thu thập dữ liệu (danh sách zip thật)",
    secret: true,
    helpText: "Miễn phí, cấp tức thì tại api.census.gov/data/key_signup.html.",
  },
  {
    name: "NREL_API_KEY",
    label: "NREL PVWatts API Key",
    group: "Thu thập dữ liệu (danh sách zip thật)",
    secret: true,
    helpText: "Miễn phí, cấp tức thì tại developer.nlr.gov/signup/ (developer.nrel.gov đã ngừng hoạt động từ 29/5/2026 — NREL đổi tên thành NLR).",
  },
  {
    name: "NOAA_API_TOKEN",
    label: "NOAA CDO API Token",
    group: "Thu thập dữ liệu (danh sách zip thật)",
    secret: true,
    helpText: "Miễn phí, cấp qua email tại ncdc.noaa.gov/cdo-web/token. Cần token thật ngay cả để tra cứu metadata — không có cách kiểm tra không cần token.",
  },
  {
    name: "EIA_API_KEY",
    label: "EIA Open Data API Key",
    group: "Thu thập dữ liệu (danh sách zip thật)",
    secret: true,
    helpText: "Miễn phí, cấp qua email tức thì tại eia.gov/opendata.",
  },
  {
    name: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
    group: "Sinh nội dung AI",
    secret: true,
    helpText:
      "Lấy tại console.anthropic.com. Đặt ở đây thay vì trong .env của từng website: một key duy nhất, một bộ kiểm tra chống bịa số duy nhất, và một trần chi tiêu duy nhất cho mọi site. Trần mặc định $5 — đổi ở AppConfig key \"ai\".",
  },
  {
    name: "FEMA_API_BASE_URL",
    label: "FEMA — Base URL (proxy)",
    group: "Thu thập dữ liệu (danh sách zip thật)",
    secret: false,
    helpText:
      "Để trống = gọi thẳng https://www.fema.gov. Akamai chặn fema.gov theo dải IP datacenter, nên VPS " +
      "nhận 403 cho MỌI request trong khi cùng URL đó trả 200 từ mạng dân dụng — không phải vấn đề khoá, " +
      "FEMA không dùng khoá. Điền URL Cloudflare Worker proxy vào đây để đi vòng. Giữ nguyên đường dẫn: " +
      "proxy nối thẳng /api/open/... vào fema.gov.",
  },
  {
    name: "FEMA_PROXY_SECRET",
    label: "FEMA — Proxy secret",
    group: "Thu thập dữ liệu (danh sách zip thật)",
    secret: true,
    helpText:
      "Gửi kèm header X-Proxy-Secret để proxy không thành open proxy cho cả internet. Chỉ cần khi đã " +
      "điền Base URL ở trên.",
  },
  {
    name: "CLOUDFLARE_API_TOKEN",
    label: "Cloudflare API Token",
    group: "Domain (Cloudflare)",
    secret: true,
    helpText: "Tạo tại dash.cloudflare.com/profile/api-tokens — cần quyền Zone:Edit và Account:Read (để tạo zone mới trong account của bạn).",
  },
  {
    name: "CLOUDFLARE_ACCOUNT_ID",
    label: "Cloudflare Account ID",
    group: "Domain (Cloudflare)",
    secret: false,
    helpText: "Xem ở cột phải trang tổng quan (Overview) của bất kỳ site nào trong tài khoản Cloudflare — mục \"Account ID\".",
  },
];

type CredentialStore = Record<string, string>;

async function readStore(): Promise<CredentialStore> {
  const row = await prisma.appConfig.findUnique({ where: { key: CONFIG_KEY } });
  return (row?.value as CredentialStore | undefined) ?? {};
}

/** DB-stored value takes precedence; falls back to the environment variable
 * of the same name so a `.env` on a deployed server still works without
 * anyone having to touch Settings. */
export async function getCredential(name: string): Promise<string | undefined> {
  const store = await readStore();
  const stored = store[name];
  if (stored) return stored;
  return process.env[name] || undefined;
}

export interface CredentialStatus {
  name: string;
  source: "settings" | "env" | "none";
  masked?: string; // last 4 characters only, never the full value
}

export async function getCredentialStatuses(): Promise<CredentialStatus[]> {
  const store = await readStore();
  return CREDENTIAL_FIELDS.map((field) => {
    const stored = store[field.name];
    if (stored) {
      return { name: field.name, source: "settings" as const, masked: maskTail(stored) };
    }
    const fromEnv = process.env[field.name];
    if (fromEnv) {
      return { name: field.name, source: "env" as const, masked: maskTail(fromEnv) };
    }
    return { name: field.name, source: "none" as const };
  });
}

function maskTail(value: string): string {
  const tail = value.slice(-4);
  return `••••${tail}`;
}

/** Only touches fields that were given a non-empty new value — leaving a
 * field blank in the form means "don't change it", not "clear it". Use
 * clearCredential() to explicitly remove a saved value. */
export async function setCredentials(updates: Record<string, string>): Promise<void> {
  const nonEmpty = Object.fromEntries(Object.entries(updates).filter(([, v]) => v.trim() !== ""));
  if (Object.keys(nonEmpty).length === 0) return;

  const current = await readStore();
  const merged = { ...current, ...nonEmpty };
  await prisma.appConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: merged },
    update: { value: merged },
  });
}

export async function clearCredential(name: string): Promise<void> {
  const current = await readStore();
  if (!(name in current)) return;
  delete current[name];
  await prisma.appConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: current },
    update: { value: current },
  });
}
