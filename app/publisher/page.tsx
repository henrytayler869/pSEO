import Link from "next/link";
import { Globe } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ConnectWebsiteForm } from "@/components/connect-website-form";
import { WpAdminLinkCell } from "@/components/wp-admin-link";
import { RemoveWebsiteButton } from "@/components/remove-website-button";
import { getWebsiteOverviewRows } from "@/lib/queries/publisher";
import { getVerticalsWithMarkets } from "@/lib/queries/verticals";
import { getBudgetStatus, formatBudgetPercent } from "@/lib/ai/budget";
import { AlertTriangle } from "lucide-react";

export default async function PublisherPage() {
  const [rows, verticals] = await Promise.all([getWebsiteOverviewRows(), getVerticalsWithMarkets()]);

  // Ngân sách hiện ở ĐÂY nữa, không chỉ trong trang chi tiết. Một cảnh báo
  // chỉ thấy được sau khi đã mở đúng site là một cảnh báo dành cho người đã
  // nghi ngờ — tức là đúng người không cần nó.
  const budgets = new Map(
    await Promise.all(rows.map(async (r) => [r.website.id, await getBudgetStatus(r.website.id)] as const))
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Globe}
        title="Publisher"
        description="Head Quarter điều phối các website pSEO (headless WordPress + Next.js) — số liệu bài viết, tỷ lệ index, traffic lấy trực tiếp từ WordPress/GSC/GA4 mỗi lần tải trang, không lưu trung gian."
      />

      <Card>
        <CardHeader>
          <CardTitle>Website đã kết nối ({rows.length})</CardTitle>
          <CardDescription>
            Tỷ lệ index là ước tính: số trang có impression trên GSC chia cho số URL trong sitemap — tức tập ta thực
            sự nộp cho Google, nên cả hai vế cùng nói về một tập hợp. Trước đây mẫu số là số bài WordPress, vốn chỉ là
            blog, nên tỷ lệ có thể vượt 100% mà vẫn hiện ra như một phần trăm bình thường. Đây vẫn không phải kết quả
            thật từ Index Coverage của Google (API công khai không cho truy vấn hàng loạt) — xem chi tiết để kiểm tra
            index thật cho từng URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ConnectWebsiteForm verticals={verticals} />
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa kết nối website nào.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Website</TableHead>
                  <TableHead>WP Admin</TableHead>
                  <TableHead>URL trong sitemap</TableHead>
                  <TableHead>Tỷ lệ index (ước tính)</TableHead>
                  <TableHead>Total traffic (28 ngày)</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.website.id}>
                    <TableCell>
                      <Link href={`/publisher/${row.website.id}`} className="font-medium hover:underline">
                        {row.website.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{row.website.url}</div>
                      {/* Ngân sách nằm ở CỘT ĐẦU, không phải cột riêng.
                          Cột riêng đẩy nó ra ngoài khung nhìn: ô WP Admin
                          chứa cả câu giải thích lẫn lệnh ssh nên bảng vốn đã
                          tràn ngang, và một highlight phải cuộn ngang mới
                          thấy thì không highlight gì cả. Đo bằng cách mở
                          trang ra xem. */}
                      {(() => {
                        const b = budgets.get(row.website.id);
                        if (!b || b.verdict === "no-budget") return null;
                        if (b.verdict === "over")
                          return (
                            <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-red-500/60 bg-red-100/70 px-1.5 py-0.5 text-xs font-medium text-red-800 tabular-nums dark:bg-red-950/40 dark:text-red-300">
                              <AlertTriangle className="h-3 w-3" />
                              AI ${b.totalUsd.toFixed(2)} / ${b.budgetUsd!.toFixed(2)}
                            </div>
                          );
                        return (
                          <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                            AI ${b.totalUsd.toFixed(2)} / ${b.budgetUsd!.toFixed(2)} ({formatBudgetPercent(b.percent)})
                          </div>
                        );
                      })()}
                    </TableCell>
                    {/*
                      WP Admin hiện KỂ CẢ khi hàng lỗi. Link đó suy ra từ cấu
                      hình, không phụ thuộc vào GSC/GA4/sitemap — chính là lúc
                      những thứ kia hỏng thì người ta mới cần vào wp-admin nhất.
                    */}
                    <TableCell>
                      <WpAdminLinkCell link={row.wpAdmin} />
                    </TableCell>
                    {row.error ? (
                      <TableCell colSpan={3} className="text-xs text-red-700">
                        Lỗi: {row.error}
                      </TableCell>
                    ) : (
                      <>
                        <TableCell>
                          {row.sitemapCount ? (
                            <span title={row.sitemapCount.breakdown.map((b) => `${b.label}: ${b.count}`).join(" · ")}>
                              {row.sitemapCount.total.toLocaleString()}
                              <span className="text-muted-foreground"> ({row.sitemapCount.content} nội dung)</span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {row.indexRateEstimate !== null ? `${(row.indexRateEstimate * 100).toFixed(0)}%` : "—"}
                        </TableCell>
                        <TableCell>{row.totalUsers?.toLocaleString()} users</TableCell>
                      </>
                    )}
                                        <TableCell>
                      <div className="flex items-center gap-2">
                        <Link href={`/publisher/${row.website.id}`} className="text-xs text-primary hover:underline">
                          Xem chi tiết
                        </Link>
                        <RemoveWebsiteButton websiteId={row.website.id} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
