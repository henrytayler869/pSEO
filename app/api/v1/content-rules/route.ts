import { requireApiKey } from "@/lib/api/auth";
import { apiJson } from "@/lib/api/cache-policy";
import { buildContentRules } from "@/lib/content-rules/registry";

/**
 * GET /api/v1/content-rules — the rules every published site must enforce.
 *
 * Served rather than documented so a new publisher inherits them instead of
 * reimplementing them, and so the second implementation of a rule cannot drift
 * from the first without a build noticing.
 *
 * Behind the API key like every other /api/v1 route. Nothing here is secret,
 * but the reserved-term list names pages that are not public yet, and the
 * metric resolutions describe data this repository is private about.
 */
export async function GET(request: Request) {
  // "no-scope" có chủ ý: đây là LUẬT mà mọi publisher phải tuân, không
  // phải dữ liệu của một niche. Giấu luật của niche khác đi không bảo vệ
  // được gì mà lại làm hai site thi hành hai bộ luật khác nhau.
  const unauthorized = await requireApiKey(request, "no-scope");
  if (unauthorized) return unauthorized;

  return apiJson(await buildContentRules());
}
