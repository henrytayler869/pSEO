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
import { checkNicheReadiness } from "@/lib/publisher/niche-readiness";

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
  const [queue, clusterQueue, spent, readiness] = await Promise.all([
    buildFillQueue(site),
    buildClusterFillQueue(site),
    getSpendUsdForVertical(site.vertical),
    checkNicheReadiness(site.vertical),
  ]);
  const notReady = readiness.checks.filter((c) => !c.ok);

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

      {/*
        Trạng thái NGHỀ, đặt TRƯỚC hàng đợi.
        
        Mỗi lần bấm ở đây là tiền thật gọi Anthropic. Sinh chữ cho một nghề
        thiếu đặc tả thì tiền vẫn tiêu, văn bản vẫn qua validator, và trang vẫn
        nói sai nghề — đúng chuỗi đã xảy ra với 90 trang ngày 18/9/2026. Nên
        thứ này đứng trước nút, không nằm trong một tab khác.
      */}
      {notReady.length > 0 && (
        <Card className={readiness.ready ? undefined : "border-destructive"}>
          <CardHeader>
            <CardTitle className={readiness.ready ? undefined : "text-destructive"}>
              {readiness.ready
                ? `Nghề "${site.vertical}" đủ để xuất bản, nhưng mỏng`
                : `Nghề "${site.vertical}" CHƯA đủ để xuất bản`}
            </CardTitle>
            <CardDescription>
              {readiness.ready
                ? "Trang sẽ đúng nghề nhưng ít nội dung hơn nghề đã đủ. Điền được, chỉ là chưa đáng xếp hạng."
                : "Điền nội dung bây giờ vẫn tốn tiền và vẫn cho ra trang nói sai nghề hoặc nói rỗng. Bù đủ phần dưới trước."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {notReady.map((c) => (
              <div key={c.key}>
                <span className={c.severity === "blocker" ? "font-medium text-destructive" : "font-medium"}>
                  {c.severity === "blocker" ? "THIẾU" : "Mỏng"}: {c.title}
                </span>
                <span className="text-muted-foreground"> — {c.detail}</span>
                {c.incident ? <p className="mt-0.5 text-xs text-muted-foreground">{c.incident}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
