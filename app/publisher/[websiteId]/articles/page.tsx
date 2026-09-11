import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/db/prisma";
import { discoverCandidates } from "@/lib/article-candidates/discover";
import { ArticleWorkbench } from "@/components/article-workbench";
import { getBudgetAction } from "./actions";

export default async function ArticlesPage({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) notFound();

  const [candidates, articles, job, spend] = await Promise.all([
    discoverCandidates(website.vertical),
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
            Bài BIÊN TẬP XUYÊN THỊ TRƯỜNG — nói về quan hệ giữa nhiều thị trường, thứ trang thị trường đơn lẻ không nói
            được. Mỗi bài phải qua toàn bộ checklist QC mới thành bản nháp; không đạt thì viết lại tối đa 3 lần rồi dừng
            và giữ lại báo cáo. Xoá là chuyển vào thùng rác, tạo là <strong>bản nháp</strong> trong WordPress.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ArticleWorkbench
            websiteId={websiteId}
            candidates={candidates.map((c) => ({
              id: c.id,
              title: c.title,
              why: c.why,
              intent: c.intent,
              angle: c.angle,
              factCount: c.facts.length,
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
