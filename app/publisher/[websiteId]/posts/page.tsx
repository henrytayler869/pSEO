import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/db/prisma";
import { listPosts } from "@/lib/wordpress/posts";
import { deriveWpApiBaseUrl } from "@/lib/wordpress/rest-api";
import { logDependencyFailure } from "@/lib/observability/dependency-log";
import { WpPostsManager, type PostRow } from "@/components/wp-posts-manager";
import { SitePages, type SitePageRow } from "@/components/site-pages";
import { fetchSitemapCounts, classifySitemapUrl } from "@/lib/sitemap/count";

export default async function PostsPage({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) notFound();

  const base = website.wpApiBaseUrl ?? deriveWpApiBaseUrl(website.url);
  const creds =
    website.wpUsername && website.wpAppPassword
      ? {
          username: website.wpUsername,
          applicationPassword: website.wpAppPassword,
          loopbackSecret: website.wpLoopbackSecret,
        }
      : null;

  let posts: PostRow[] = [];
  let sawAllStatuses = false;
  let loadError: string | null = null;
  try {
    const result = await listPosts(base, creds);
    posts = result.posts;
    sawAllStatuses = result.sawAllStatuses;
  } catch (err) {
    // Rendered, not thrown. A WordPress that is down or behind a tunnel is a
    // normal state for this setup, and a Next.js error page would hide the
    // credential form — which is the one thing that might fix it.
    //
    // Nhưng vẽ vào trang KHÔNG đủ: trang chỉ tồn tại khi có người mở nó, nên
    // một sự cố lúc 3 giờ sáng không để lại dấu vết nào. Ghi thêm một dòng
    // vào stderr để production có bản ghi.
    logDependencyFailure("wordpress-posts", err, { websiteId, base });
    loadError = err instanceof Error ? err.message : "Không đọc được danh sách bài.";
  }

  /**
   * Trang site ĐANG PHỤC VỤ — nguồn là sitemap thật, không phải WordPress.
   *
   * Đo 11/9/2026: atmovingservices.com là site Next.js. Gọi
   * /wp-json/wp/v2/pages trên chính domain đó trả về trang 404 của Next. 158
   * trang thị trường dựng từ dataset qua /api/v1, nên không REST nào của
   * WordPress nhìn thấy chúng — một bảng đọc từ WordPress sẽ mãi báo 0 trong
   * khi site có 158 trang, và đó chính là thứ màn hình này đang nói sai.
   */
  let sitePages: SitePageRow[] = [];
  let sitemapError: string | null = null;
  try {
    const sm = await fetchSitemapCounts(website.url);
    const interpreted = new Set(
      (
        await prisma.aiGeneration.findMany({
          where: { vertical: website.vertical },
          select: { zip: true },
        })
      )
        .map((g) => g.zip)
        .filter((z): z is string => z !== null)
    );
    const locations = await prisma.location.findMany({ select: { zip: true, city: true, state: true } });
    // Một thành phố có NHIỀU ZIP — Chicago có 18. Map path -> một ZIP sẽ giữ
    // cái cuối cùng, và câu trả lời "chưa có đoạn AI" lúc đó nói về một ZIP
    // chọn bừa chứ không về trang đang hiển thị. Gom hết rồi đếm.
    const zipsByPath = new Map<string, string[]>();
    for (const l of locations) {
      if (!l.city) continue;
      const slug = l.city.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const key = `/${website.vertical}/${l.state.toLowerCase()}/${slug}`;
      zipsByPath.set(key, [...(zipsByPath.get(key) ?? []), l.zip]);
    }

    sitePages = sm.urls.map((u) => {
      const { path, kind } = classifySitemapUrl(u, website.url);
      const zips = zipsByPath.get(path);
      // null khi HQ không biết ZIP nào đứng sau trang đó: câu hỏi "đã có đoạn
      // AI chưa" lúc ấy không áp dụng, và trả lời "chưa" sẽ là một khẳng định
      // về thứ chưa tra được.
      if (!zips) return { path, kind, interpretation: null };
      return {
        path,
        kind,
        interpretation: { withAi: zips.filter((z) => interpreted.has(z)).length, total: zips.length },
      };
    });
  } catch (err) {
    logDependencyFailure("sitemap", err, { websiteId, site: website.url });
    sitemapError = err instanceof Error ? err.message : "Không đọc được sitemap.";
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/publisher"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại Publisher
        </Link>
      </div>

      <PageHeader icon={Globe} title={website.name} description={website.url} />

      <div className="flex gap-1 border-b">
        <Link
          href={`/publisher/${websiteId}`}
          className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Tổng quan
        </Link>
        <Link
          href={`/publisher/${websiteId}/onpage`}
          className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          OnPage
        </Link>
        <span className="border-b-2 border-foreground px-3 py-2 text-sm font-medium">Bài viết</span>
        <Link
          href={`/publisher/${websiteId}/articles`}
          className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Tạo bài viết
        </Link>
<Link
          href={`/publisher/${websiteId}/templates`}
          className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Template
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bài viết WordPress</CardTitle>
          <CardDescription>
            Đọc thẳng từ WordPress mỗi lần tải trang — không có bản sao nào ở đây, nên những gì bạn thấy là những gì
            WordPress đang có. Sửa và tạo bài cần Application Password; xoá là <strong>chuyển vào thùng rác</strong>,
            khôi phục được trong wp-admin, không phải xoá vĩnh viễn.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WpPostsManager
            websiteId={websiteId}
            username={website.wpUsername}
            posts={posts}
            sawAllStatuses={sawAllStatuses}
            loadError={loadError}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Trang trên site</CardTitle>
          <CardDescription>
            Đọc từ sitemap thật của site, KHÔNG phải từ WordPress. Những trang này do site dựng từ dataset qua
            <code> /api/v1</code>, nên không REST nào của WordPress nhìn thấy chúng — bảng &ldquo;Bài viết WordPress&rdquo;
            ở trên sẽ mãi báo 0 dù site đang phục vụ hàng trăm trang, và hai con số đó nói về hai thứ khác nhau.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SitePages rows={sitePages} siteUrl={website.url} error={sitemapError} />
        </CardContent>
      </Card>

    </div>
  );
}
