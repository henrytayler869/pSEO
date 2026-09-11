import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/db/prisma";
import { discoverCandidates, buildCandidate, isIntent } from "@/lib/article-candidates/discover";
import { renderArticle } from "@/lib/article-template/render";
import { TemplateEditor } from "@/components/template-editor";
import { listTemplates } from "./actions";

const PLACEHOLDER_PARAGRAPH =
  "[Đoạn AI diễn giải xuất hiện ở đây. Nội dung thật khác nhau giữa các bài — đó là lý do khối này tồn tại.]";

export default async function TemplatesPage({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) notFound();

  const [rows, candidates, sources] = await Promise.all([
    listTemplates(websiteId),
    discoverCandidates(website.vertical),
    prisma.dataSource.findMany({
      where: { isActive: true, relevantVerticals: { has: website.vertical } },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Xem trước dựng từ ỨNG VIÊN THẬT, không phải số liệu bịa. Một bản xem trước
  // bằng dữ liệu giả cho thấy một trang không tồn tại, và sai lệch duy nhất
  // nó giấu đi lại đúng là thứ người ta cần thấy: số liệu thật dài bao nhiêu,
  // tên khu vực thật đọc ra sao.
  //
  // knownPaths để rỗng: sitemap phải gọi mạng, và một bản xem trước chậm là
  // bản xem trước không ai bấm. Hệ quả là khối link nội bộ KHÔNG hiện ở đây —
  // ghi rõ bên dưới, vì một khối vắng mặt không giải thích sẽ bị đọc là "tôi
  // đã xoá nó".
  // Một ứng viên thật cho mỗi intent, dựng fact đầy đủ. Chỉ dựng cho ứng viên
  // ĐẦU TIÊN của mỗi intent: buildFactSet mất vài giây một ZIP, và bản xem
  // trước cần một trang thật, không cần 218 trang thật.
  const previews: Record<string, string | null> = {};
  for (const r of rows) {
    const summary = candidates[0];
    const c = summary && isIntent(r.intent) ? await buildCandidate(website.vertical, summary.zip, r.intent) : null;
    if (!c) {
      previews[r.intent] = null;
      continue;
    }
    const rendered = renderArticle({
      template: r.shape,
      candidate: c,
      aiParagraph: PLACEHOLDER_PARAGRAPH,
      knownPaths: new Set<string>(),
      sourceNames: sources.map((s) => s.name),
    });
    previews[r.intent] = `<h1>${rendered.title}</h1><p><em>${rendered.metaDescription}</em></p>${rendered.html}`;
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

      <PageHeader icon={Globe} title={website.name} description={`${website.url} · ${website.vertical}`} />

      <div className="flex gap-1 border-b">
        <Link href={`/publisher/${websiteId}`} className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Tổng quan</Link>
        <Link href={`/publisher/${websiteId}/onpage`} className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground">OnPage</Link>
        <Link href={`/publisher/${websiteId}/posts`} className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Bài viết</Link>
        <Link href={`/publisher/${websiteId}/articles`} className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Tạo bài viết</Link>
        <span className="border-b-2 border-foreground px-3 py-2 text-sm font-medium">Template</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Template bài viết</CardTitle>
          <CardDescription>
            Template nằm ở đây chứ không phải trong Cài đặt vì nó thuộc về từng website — hai site cùng ngành vẫn khác
            trang pillar, khác cách xưng hô. Checklist QC thì ngược lại: nó chung cho mọi site, nên ở Cài đặt.
            Sửa ở đây áp dụng cho bài tạo từ lúc lưu; bài đã viết giữ nguyên.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TemplateEditor websiteId={websiteId} rows={rows} previews={previews} />
        </CardContent>
      </Card>
    </div>
  );
}
