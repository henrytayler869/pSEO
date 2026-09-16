import { prisma } from "@/lib/db/prisma";
import { requireApiKey } from "@/lib/api/auth";
import { apiJson } from "@/lib/api/cache-policy";
import { normalizeHost } from "@/lib/publisher/link-domain";
import { buildSiteConfig } from "@/lib/publisher/site-config";

/**
 * GET /api/v1/sites/{host}/config — the settings a published site needs about
 * itself, so nobody has to hand-edit a file on a server to change them.
 *
 * Từ 16/9/2026 nó trả về TOÀN BỘ danh tính hiển thị của site — tên, tagline,
 * description, niche — chứ không chỉ mã analytics. Lý do là mô hình đã đổi:
 * MỘT app phục vụ nhiều domain, phân biệt theo Host, nên hằng số `SITE` trong
 * mã nguồn publisher không còn đúng. Một hằng số ở đó sẽ gán danh tính của
 * site này cho mọi site khác, và trang vẫn render đủ, vẫn 200, chỉ sai thương
 * hiệu và sai mã analytics.
 *
 * Phản hồi kèm `ready` và `missing`. Trả cấu hình KÈM phán quyết chứ không từ
 * chối trả: app vẫn phải dựng được trang cho một site thiếu tagline, còn thứ
 * bị chặn là hành động DỰNG MỚI.
 *
 * Trước đó nó chỉ trả GA4 measurement ID. It lived in .env.production, which
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
    select: {
      id: true,
      name: true,
      url: true,
      vertical: true,
      tagline: true,
      description: true,
      ga4MeasurementId: true,
      wpApiBaseUrl: true,
    },
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

  // Hình dạng phản hồi dựng ở lib/publisher/site-config.ts, không dựng tại
  // chỗ này: nút "Dựng Site" bên HQ phải hỏi CÙNG một câu "site này đã đủ
  // chưa" mà endpoint trả lời, và hai nơi tự trả lời riêng là hai câu trả lời
  // sẽ trôi lệch.
  return apiJson(buildSiteConfig(match, wanted));
}

