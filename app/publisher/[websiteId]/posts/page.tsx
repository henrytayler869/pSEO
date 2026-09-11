import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/db/prisma";
import { listPosts } from "@/lib/wordpress/posts";
import { deriveWpApiBaseUrl } from "@/lib/wordpress/rest-api";
import { WpPostsManager, type PostRow } from "@/components/wp-posts-manager";

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
    loadError = err instanceof Error ? err.message : "Không đọc được danh sách bài.";
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
    </div>
  );
}
