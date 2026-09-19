import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { PublisherTabs, PublisherSubTabs, gscSubTabs } from "@/components/publisher-tabs";
import { WindowPicker } from "@/components/window-picker";
import { getGscTabData, parseWindow } from "@/lib/queries/publisher-analytics";

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function Failed({ error }: { error: string }) {
  return <p className="text-sm text-destructive">{error}</p>;
}

export default async function GscPage({
  params,
  searchParams,
}: {
  params: Promise<{ websiteId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { websiteId } = await params;
  const days = parseWindow((await searchParams).days);
  const data = await getGscTabData(websiteId, days);
  if (!data) notFound();

  const { website, totals, pages, queries } = data;
  const base = `/publisher/${websiteId}/gsc`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/publisher/${websiteId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại {website.name}
        </Link>
      </div>

      <PublisherTabs websiteId={websiteId} active="gsc" />
      <PublisherSubTabs items={gscSubTabs(websiteId)} active="gsc" />

      <PageHeader
        icon={Search}
        title="Search Console"
        description={`Số liệu tìm kiếm của ${website.url}, property ${website.gscPropertyUrl}. Google trả dữ liệu trễ 2–3 ngày, nên khoảng ngắn nhất luôn thiếu phần đuôi.`}
      />

      <WindowPicker base={base} active={days} />

      <Card>
        <CardHeader>
          <CardTitle>Tổng quan {days} ngày</CardTitle>
          <CardDescription>
            <strong>Số trang có hiển thị</strong> là con số đáng theo dõi với một site pSEO: nó nói bao nhiêu mẫu trang đã
            vào được kết quả tìm kiếm, trong khi số nhấp chỉ nói phần đã chín.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!totals.ok ? (
            <Failed error={totals.error} />
          ) : (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <div>
                <dt className="text-xs text-muted-foreground">Nhấp</dt>
                <dd className="text-2xl font-semibold">{totals.value.clicks.toLocaleString("vi-VN")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Hiển thị</dt>
                <dd className="text-2xl font-semibold">{totals.value.impressions.toLocaleString("vi-VN")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">CTR</dt>
                <dd className="text-2xl font-semibold">{pct(totals.value.ctr)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Hạng TB</dt>
                <dd className="text-2xl font-semibold">{totals.value.avgPosition.toFixed(1)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Trang có hiển thị</dt>
                <dd className="text-2xl font-semibold">{totals.value.pagesWithImpressions.toLocaleString("vi-VN")}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Truy vấn</CardTitle>
          <CardDescription>
            Người ta GÕ gì. Google ẩn phần lớn truy vấn hiếm, nên tổng của bảng này luôn nhỏ hơn tổng ở trên — đó là giới
            hạn của Search Console, không phải số liệu thiếu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!queries.ok ? (
            <Failed error={queries.error} />
          ) : queries.value.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có truy vấn nào trong {days} ngày qua.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Truy vấn</th>
                    <th className="py-1 pr-3 text-right">Hiển thị</th>
                    <th className="py-1 pr-3 text-right">Nhấp</th>
                    <th className="py-1 pr-3 text-right">CTR</th>
                    <th className="py-1 text-right">Hạng</th>
                  </tr>
                </thead>
                <tbody>
                  {queries.value.slice(0, 30).map((q) => (
                    <tr key={q.query} className="border-t">
                      <td className="py-1 pr-3">{q.query}</td>
                      <td className="py-1 pr-3 text-right">{q.impressions.toLocaleString("vi-VN")}</td>
                      <td className="py-1 pr-3 text-right">{q.clicks}</td>
                      <td className="py-1 pr-3 text-right">{pct(q.ctr)}</td>
                      <td className="py-1 text-right">{q.position.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trang</CardTitle>
          <CardDescription>Trang nào được xem trong kết quả tìm kiếm, xếp theo số nhấp.</CardDescription>
        </CardHeader>
        <CardContent>
          {!pages.ok ? (
            <Failed error={pages.error} />
          ) : pages.value.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có trang nào có hiển thị trong {days} ngày qua.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Trang</th>
                    <th className="py-1 pr-3 text-right">Hiển thị</th>
                    <th className="py-1 pr-3 text-right">Nhấp</th>
                    <th className="py-1 pr-3 text-right">CTR</th>
                    <th className="py-1 text-right">Hạng</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.value.slice(0, 30).map((p) => (
                    <tr key={p.page} className="border-t">
                      <td className="py-1 pr-3 font-mono">{p.page.replace(website.url, "") || "/"}</td>
                      <td className="py-1 pr-3 text-right">{p.impressions.toLocaleString("vi-VN")}</td>
                      <td className="py-1 pr-3 text-right">{p.clicks}</td>
                      <td className="py-1 pr-3 text-right">{pct(p.ctr)}</td>
                      <td className="py-1 text-right">{p.position.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
