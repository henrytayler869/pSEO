import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/db/prisma";
import { buildFillQueue } from "@/lib/queries/fill-queue";
import { getSpendUsdForVertical } from "@/lib/ai/anthropic";
import { ContentFillQueue } from "@/components/content-fill-queue";

/**
 * Hàng đợi điền nội dung của một publisher.
 *
 * CHẬM có chủ ý: dựng hàng đợi hỏi đường phục vụ cho từng ZIP, qua đúng hàm
 * mà endpoint hỏi. Hỏi câu yếu hơn ("có hàng nào trong bảng không") thì nhanh
 * hơn nhiều và SAI — đúng cách script sinh từng báo "đã có 127 | sẽ sinh 0"
 * trong khi 101 trang đang mất chữ.
 */
export default async function ContentPage({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const site = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, name: true, vertical: true, url: true, aiBudgetUsd: true },
  });
  if (!site) notFound();

  // Chi tiêu CỦA NGHỀ NÀY — cùng đơn vị với ngân sách hiện ngay cạnh nó, và
  // cùng đơn vị với con số mà nút điền đem so. Hiện tổng toàn hệ ở đây trong
  // khi nút so theo nghề sẽ cho người bấm đọc một số rồi gặp một số khác.
  const [queue, spent] = await Promise.all([buildFillQueue(site), getSpendUsdForVertical(site.vertical)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={FileText}
        title={`Nội dung — ${site.name}`}
        description={`Điền đoạn diễn giải cho niche ${site.vertical}, theo thứ tự từ khoá quan trọng nhất.`}
      />
      <Link href={`/publisher/${websiteId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="size-3.5" /> Về trang publisher
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Hàng đợi</CardTitle>
          <CardDescription>
            Xếp theo lượng tìm kiếm đo được. ZIP chưa đo từ khoá xuống cuối chứ không bị loại — thiếu số đo nghĩa là chưa ai
            đo, không phải không có nhu cầu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ContentFillQueue
            websiteId={site.id}
            vertical={site.vertical}
            summary={queue.summary}
            pending={queue.pending}
            budgetUsd={site.aiBudgetUsd}
            spentUsd={spent}
            excluded={queue.excluded}
            unavailable={queue.unavailable}
          />
        </CardContent>
      </Card>
    </div>
  );
}
