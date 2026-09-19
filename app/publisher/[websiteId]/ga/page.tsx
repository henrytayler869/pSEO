import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { PublisherTabs } from "@/components/publisher-tabs";
import { WindowPicker } from "@/components/window-picker";
import { getGaTabData, parseWindow } from "@/lib/queries/publisher-analytics";

function mmss(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Failed({ error }: { error: string }) {
  return <p className="text-sm text-destructive">{error}</p>;
}

export default async function GaPage({
  params,
  searchParams,
}: {
  params: Promise<{ websiteId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { websiteId } = await params;
  const days = parseWindow((await searchParams).days);
  const data = await getGaTabData(websiteId, days);
  if (!data) notFound();

  const { website, totals, bySource, landing } = data;
  const base = `/publisher/${websiteId}/ga`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/publisher/${websiteId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại {website.name}
        </Link>
      </div>

      <PublisherTabs websiteId={websiteId} active="ga" />

      <PageHeader
        icon={BarChart3}
        title="Google Analytics 4"
        description={`Hành vi người thật trên ${website.url}, property ${website.ga4PropertyId}. GSC nói người ta thấy gì trên Google; GA4 nói chuyện gì xảy ra sau khi họ bấm vào.`}
      />

      <WindowPicker base={base} active={days} />

      <Card>
        <CardHeader>
          <CardTitle>Tổng quan {days} ngày</CardTitle>
        </CardHeader>
        <CardContent>
          {!totals.ok ? (
            <Failed error={totals.error} />
          ) : (
            <dl className="grid grid-cols-3 gap-4">
              <div>
                <dt className="text-xs text-muted-foreground">Người dùng</dt>
                <dd className="text-2xl font-semibold">{totals.value.activeUsers.toLocaleString("vi-VN")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Phiên</dt>
                <dd className="text-2xl font-semibold">{totals.value.sessions.toLocaleString("vi-VN")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Lượt xem trang</dt>
                <dd className="text-2xl font-semibold">{totals.value.screenPageViews.toLocaleString("vi-VN")}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nguồn truy cập</CardTitle>
          <CardDescription>
            Với site pSEO, tỷ trọng <em>Organic Search</em> là thước đo trực tiếp: mọi trang thị trường sinh ra để vào
            qua cửa đó. Direct cao bất thường ở một site mới thường là chính mình đang tự vào.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!bySource.ok ? (
            <Failed error={bySource.error} />
          ) : bySource.value.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có phiên nào trong {days} ngày qua.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Kênh</th>
                  <th className="py-1 pr-3 text-right">Phiên</th>
                  <th className="py-1 text-right">Người dùng</th>
                </tr>
              </thead>
              <tbody>
                {bySource.value.map((r) => (
                  <tr key={r.dimensionValue} className="border-t">
                    <td className="py-1 pr-3">{r.dimensionValue}</td>
                    <td className="py-1 pr-3 text-right">{r.sessions.toLocaleString("vi-VN")}</td>
                    <td className="py-1 text-right">{r.activeUsers.toLocaleString("vi-VN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trang vào</CardTitle>
          <CardDescription>
            Cửa nào mở, không phải trang nào được xem nhiều. Mỗi trang thị trường là một cửa riêng cho một truy vấn
            riêng, nên bảng này nói mẫu nào đang hoạt động — lượt xem trang thì trộn cả người đã vào rồi bấm quanh.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!landing.ok ? (
            <Failed error={landing.error} />
          ) : landing.value.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có phiên nào trong {days} ngày qua.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Trang vào</th>
                    <th className="py-1 pr-3 text-right">Phiên</th>
                    <th className="py-1 pr-3 text-right">Người dùng</th>
                    <th className="py-1 text-right">TG phiên TB</th>
                  </tr>
                </thead>
                <tbody>
                  {landing.value.slice(0, 30).map((r) => (
                    <tr key={r.path} className="border-t">
                      <td className="py-1 pr-3 font-mono">{r.path}</td>
                      <td className="py-1 pr-3 text-right">{r.sessions.toLocaleString("vi-VN")}</td>
                      <td className="py-1 pr-3 text-right">{r.activeUsers.toLocaleString("vi-VN")}</td>
                      <td className="py-1 text-right">{mmss(r.avgSessionSeconds)}</td>
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
