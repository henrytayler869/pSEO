import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/db/prisma";
import { discoverCandidates, isIntent, type Intent } from "@/lib/article-candidates/discover";
import { fetchSitemapCounts } from "@/lib/sitemap/count";
import { ArticleWorkbench } from "@/components/article-workbench";
import { getBudgetAction } from "./actions";

export default async function ArticlesPage({
  params,
  searchParams,
}: {
  params: Promise<{ websiteId: string }>;
  searchParams: Promise<{ intent?: string }>;
}) {
  const { websiteId } = await params;
  const { intent: intentParam } = await searchParams;
  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) notFound();

  // Intent nằm trên URL, không nằm trong state của client.
  //
  // Nó quyết định tiêu đề gợi ý và chỉ số nào mở đầu bài — cả hai đều dựng ở
  // server. Để nó trong state thì nút bấm sẽ đổi màu mà nội dung không đổi,
  // một nút trông như có tác dụng nhưng không có.
  const intent: Intent = isIntent(intentParam) ? intentParam : "move-underway";

  // Đường dẫn site ĐANG phục vụ, để không mời viết trùng trang market đã có.
  // Lỗi mạng thì trả về rỗng: không loại trừ ai, và danh sách dài bất thường
  // là thứ nhìn thấy được — im lặng bỏ qua nơi đáng viết thì không.
  const servedPaths = await fetchSitemapCounts(website.url).then(
    (s) => new Set(s.urls.map((u) => new URL(u).pathname.replace(/\/+$/, ""))),
    () => new Set<string>()
  );

  const [candidates, articles, job, spend] = await Promise.all([
    discoverCandidates(website.vertical, { intent, servedPaths }),
    prisma.article.findMany({ where: { websiteId }, orderBy: { createdAt: "desc" } }),
    prisma.articleJob.findFirst({ where: { websiteId }, orderBy: { startedAt: "desc" } }),
    prisma.aiSpend.aggregate({ where: { websiteId }, _sum: { costUsd: true } }),
  ]);

  const budget = await getBudgetAction();

  const written = new Set(articles.map((a) => a.candidateId));

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

      <PageHeader icon={Globe} title={website.name} description={`${website.url} · ${website.vertical}`} />

      <div className="flex gap-1 border-b">
        <Link href={`/publisher/${websiteId}`} className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Tổng quan</Link>
        <Link href={`/publisher/${websiteId}/onpage`} className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground">OnPage</Link>
        <Link href={`/publisher/${websiteId}/posts`} className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Bài viết</Link>
        <span className="border-b-2 border-foreground px-3 py-2 text-sm font-medium">Tạo bài viết</span>
        <Link href={`/publisher/${websiteId}/templates`} className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Template</Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ứng viên từ dataset</CardTitle>
          <CardDescription>
            Một bài cho MỘT ĐỊA ĐIỂM, ráp từ toàn bộ chỉ số đo được ở nơi đó — cùng template, khác số liệu và khác
            đoạn AI diễn giải. Những nơi site đã có trang market bị loại khỏi danh sách, để không dựng hai trang cạnh
            tranh nhau trên cùng domain. Ý định người đọc quyết định tiêu đề và chỉ số nào mở đầu, KHÔNG bỏ bớt chỉ số
            nào. Mỗi bài phải qua toàn bộ checklist QC mới thành bản nháp; không đạt thì viết lại tối đa 3 lần rồi dừng
            và giữ lại báo cáo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ArticleWorkbench
            websiteId={websiteId}
            intent={intent}
            candidates={candidates.map((c) => ({
              id: c.id,
              title: c.title,
              why: c.why,
              intent: c.intent,
              factCount: c.metricCount,
              written: written.has(c.id),
            }))}
            articles={articles.map((a) => ({
              id: a.id,
              title: a.title,
              status: a.status,
              attempts: a.attempts,
              costUsd: a.costUsd,
              wpPostId: a.wpPostId,
              qcReport: a.qcReport as unknown as { passed: boolean; checks: { id: string; label: string; passed: boolean; detail: string }[] },
            }))}
            job={job ? { id: job.id, status: job.status, total: job.total, done: job.done, failed: job.failed, currentTitle: job.currentTitle, error: job.error } : null}
            totalSpendUsd={spend._sum.costUsd ?? 0}
            budget={budget}
          />
        </CardContent>
      </Card>
    </div>
  );
}
