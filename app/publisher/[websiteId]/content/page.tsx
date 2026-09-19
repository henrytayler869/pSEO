import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/db/prisma";
import { buildFillQueue } from "@/lib/queries/fill-queue";
import { getSpendUsdForVertical } from "@/lib/ai/anthropic";
import { ContentFillQueue } from "@/components/content-fill-queue";
import { ClusterFillQueue } from "@/components/cluster-fill-queue";
import { buildClusterFillQueue } from "@/lib/queries/cluster-fill-queue";

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
  // Hai hàng đợi dựng SONG SONG. Mỗi cái đều tự hỏi /api/inventory và tự dựng
  // fact set, nên chạy nối tiếp là cộng thẳng hai lần chờ vào một màn hình vốn
  // đã chậm có chủ ý.
  const [queue, clusterQueue, spent] = await Promise.all([
    buildFillQueue(site),
    buildClusterFillQueue(site),
    getSpendUsdForVertical(site.vertical),
  ]);

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
            needsReview={queue.needsReview}
            unavailable={queue.unavailable}
          />
        </CardContent>
      </Card>

      {/* Hàng đợi THỨ HAI, không phải một tab của cái trên.
          Trang cụm không đọc đoạn theo ZIP, nên hai thứ này không thay thế nhau
          được — và khi một site chỉ còn việc cụm, cái trên sẽ báo "không còn gì
          để điền" trong khi những từ khoá lớn nhất của site vẫn 100% template. */}
      <Card>
        <CardHeader>
          <CardTitle>Trang cụm</CardTitle>
          <CardDescription>
            Một trang gộp nhiều ZIP, nên nó không có &ldquo;giá trị của nơi này&rdquo; — thứ nó nói được mà trang ZIP lẻ
            không nói nổi là DẢI. Đoạn cấp cụm là một lớp riêng, sinh riêng, và trang cụm không đọc đoạn theo ZIP.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClusterFillQueue
            websiteId={site.id}
            summary={clusterQueue.summary}
            pending={clusterQueue.pending}
            unavailable={clusterQueue.unavailable}
          />
        </CardContent>
      </Card>
    </div>
  );
}
