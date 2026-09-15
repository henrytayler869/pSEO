import { prisma } from "@/lib/db/prisma";
import { requireApiKey } from "@/lib/api/auth";
import { apiJson } from "@/lib/api/cache-policy";
import { normalizeHost } from "@/lib/publisher/link-domain";

/**
 * GET /api/v1/sites/{host}/config — the settings a published site needs about
 * itself, so nobody has to hand-edit a file on a server to change them.
 *
 * Right now that is the GA4 measurement ID. It lived in .env.production, which
 * meant changing it required SSH access, knowing which file, and knowing that
 * NEXT_PUBLIC_* is inlined at build time so a restart does nothing. Three
 * pieces of knowledge, none of them written down where the person changing an
 * analytics setting would look, guarding a value that fails silently when
 * wrong.
 *
 * Keyed by HOST rather than by the database id, because the site knows its own
 * hostname without being told and does not know its row in someone else's
 * database. Matching is done on the parsed host of the stored URL — not a
 * string compare against the URL — so "https://example.com/" and
 * "https://example.com" cannot disagree about whether they are the same site.
 */
export async function GET(request: Request, context: RouteContext<"/api/v1/sites/[host]/config">) {
  const { host } = await context.params;

  const unauthorized = await requireApiKey(request, { host: decodeURIComponent(host) });
  if (unauthorized) return unauthorized;
  const wanted = normalizeHost(decodeURIComponent(host));
  if (!wanted) {
    return apiJson({ error: "Thiếu host." }, { status: 400 });
  }

  const websites = await prisma.website.findMany({
    select: { id: true, name: true, url: true, ga4MeasurementId: true },
  });
  const match = websites.find((w) => normalizeHost(w.url) === wanted);

  if (!match) {
    // 404 names what was searched for, because the likeliest cause is that the
    // site is registered under a different host (www vs apex, or a staging
    // domain) and the fastest fix is seeing which hosts exist.
    return apiJson(
      {
        error: `Chưa có website nào đăng ký cho host "${wanted}".`,
        // Cố tình KHÔNG liệt kê các host khác. Trước đây có, và nó biến một
        // lỗi gõ nhầm host thành danh sách mọi site đang chạy. Với khoá theo
        // publisher thì nhánh này gần như chỉ còn khoá dùng chung cũ chạm
        // tới, nhưng "gần như" không phải lý do để vẫn rò.
      },
      { status: 404 }
    );
  }

  return apiJson({
    websiteId: match.id,
    name: match.name,
    host: wanted,
    // null is a real answer meaning "analytics not configured", distinct from
    // the 404 above meaning "this site is not registered at all". A caller that
    // conflates them would silently drop the tag whenever the host was wrong.
    ga4MeasurementId: match.ga4MeasurementId,
  });
}

