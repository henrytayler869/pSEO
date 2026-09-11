import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/db/prisma";
import { discoverCandidates, type Intent } from "@/lib/article-candidates/discover";
import { marketIntents } from "@/lib/keywords/intents";
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

  // Ý định lấy từ NGHIÊN CỨU TỪ KHOÁ của ngành, không từ một danh sách trong
  // code. Chỉ chấp nhận ý định thật sự có trong dữ liệu; một giá trị lạ trên
  // URL rơi về ý định có volume lớn nhất.
  //
  // Chưa đo được ý định nào thì intent là null, và màn hình nói thế — không
  // rơi về một giá trị mặc định trông như một kết luận đã có.
  // Nút bấm và bộ lọc đọc CÙNG một nguồn: ý định đo trên từ khoá của từng
  // thị trường. Hai nguồn cho một câu hỏi là cách con số trên nút không khớp
  // số dòng bên dưới, và không ai biết bên nào sai.
  const intents = await marketIntents(website.vertical);
  const intent: Intent | null = intents.some((i) => i.id === intentParam) ? (intentParam as Intent) : intents[0]?.id ?? null;

  // Đường dẫn site ĐANG phục vụ, để không mời viết trùng trang market đã có.
  // Lỗi mạng thì trả về rỗng: không loại trừ ai, và danh sách dài bất thường
  // là thứ nhìn thấy được — im lặng bỏ qua nơi đáng viết thì không.
  const servedPaths = await fetchSitemapCounts(website.url).then(
    (s) => new Set(s.urls.map((u) => new URL(u).pathname.replace(/\/+$/, ""))),
    () => new Set<string>()
  );

  const [candidates, articles, job, spend] = await Promise.all([
    intent ? discoverCandidates(website.vertical, { intent, servedPaths }) : Promise.resolve([]),
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
            tranh nhau trên cùng domain. Ý định đo cho TỪNG thị trường, từ chính từ khoá nơi đó đang nhắm — không khai báo trong code, và không một
            nhãn chung cho cả ngành: cùng một mẫu câu mà Chicago là informational còn Pflugerville
            là transactional. Thứ tự chỉ số thì theo VÙNG ĐO: số liệu đo tại ZIP lên trước, county/state xuống sau. Mỗi bài phải qua toàn bộ checklist QC mới thành bản nháp; không đạt thì viết lại tối đa 3 lần rồi dừng
            và giữ lại báo cáo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ArticleWorkbench
            websiteId={websiteId}
            intent={intent}
            intents={intents}
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
