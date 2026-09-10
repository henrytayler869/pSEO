import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { getOnPageView } from "@/lib/queries/on-page";
import { OnPageCrawlForm } from "@/components/on-page-crawl-form";

export default async function OnPagePage({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const view = await getOnPageView(websiteId);
  if (!view) notFound();

  const { website, summary, error, sitemapTotal, estimatedCostUsd } = view;

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
        <span className="border-b-2 border-foreground px-3 py-2 text-sm font-medium">OnPage</span>
        <Link
          href={`/publisher/${websiteId}/posts`}
          className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Bài viết
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quét OnPage (DataForSEO)</CardTitle>
          <CardDescription>
            Quét là bước DUY NHẤT tốn tiền: khoảng {(estimatedCostUsd * 100).toFixed(2)} cent cho {sitemapTotal} trang.
            Mọi lệnh đọc kết quả sau đó đều miễn phí, nên chỉ quét lại khi site đã thay đổi. Kết quả không có ngay —
            quét chạy nền vài phút, tải lại trang để xem tiến độ.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OnPageCrawlForm
            websiteId={websiteId}
            maxPages={sitemapTotal}
            lastCrawlAt={website.onPageTaskAt ? website.onPageTaskAt.toISOString() : null}
            hasTask={Boolean(website.onPageTaskId)}
          />
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-red-700">{error}</p>
          </CardContent>
        </Card>
      )}

      {!error && !summary && !website.onPageTaskId && (
        <Card>
          <CardContent className="pt-6">
            {/* Trạng thái bình thường của một site chưa ai quét — nói bằng lời
                thay vì để một trang trống tự giải thích. */}
            <p className="text-sm text-muted-foreground">
              Chưa quét lần nào. Bấm &quot;Bắt đầu quét&quot; ở trên để DataForSEO đi qua site và liệt kê những gì cần
              sửa.
            </p>
          </CardContent>
        </Card>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              label="Tiến độ quét"
              value={summary.crawlProgress === "finished" ? "đã xong" : summary.crawlProgress}
            />
            <Stat
              label="Trang đã quét"
              value={`${summary.pagesCrawled.toLocaleString()}${
                summary.pagesInQueue > 0 ? ` (còn ${summary.pagesInQueue} chờ)` : ""
              }`}
            />
            <Stat label="Điểm OnPage" value={summary.onPageScore !== null ? summary.onPageScore.toFixed(1) : "—"} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Vấn đề cần chỉnh sửa ({summary.issues.length})</CardTitle>
              <CardDescription>
                Số bên phải là SỐ TRANG dính lỗi đó, không phải số lần xuất hiện. Danh sách chỉ gồm những mục thật sự
                là vấn đề — các chỉ số trung tính như &quot;số trang dùng HTTPS&quot; bị loại ra để chúng không chôn
                vùi phần đáng sửa.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summary.issues.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {summary.crawlProgress === "finished"
                    ? "Không phát hiện vấn đề nào trong danh mục đang theo dõi."
                    : "Chưa có vấn đề nào — nhưng quét CHƯA xong, nên con số này chưa phải kết luận."}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mức</TableHead>
                      <TableHead>Vấn đề</TableHead>
                      <TableHead className="text-right">Số trang</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.issues.map((i) => (
                      <TableRow key={i.key}>
                        <TableCell>
                          <Badge variant={i.severity === "error" ? "destructive" : "outline"}>
                            {i.severity === "error" ? "Lỗi" : i.severity === "warning" ? "Cảnh báo" : "Thông tin"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {i.label}
                          <div className="font-mono text-xs text-muted-foreground">{i.key}</div>
                        </TableCell>
                        <TableCell className="text-right font-medium">{i.count.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {summary.unclassified.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Chưa phân loại ({summary.unclassified.length})</CardTitle>
                <CardDescription>
                  DataForSEO trả về những mục này nhưng code chưa có nhãn cho chúng. Hiện ra thay vì bỏ đi: một mục
                  không được nhận ra mà bị giấu thì không phân biệt được với không có vấn đề gì.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-1 text-xs">
                  {summary.unclassified.map((u) => (
                    <li key={u.key} className="flex justify-between gap-4">
                      <span className="font-mono">{u.key}</span>
                      <span className="font-medium">{u.count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
