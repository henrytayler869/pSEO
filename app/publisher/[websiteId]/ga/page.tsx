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
        description={`Hành vi trên ${website.url}, property ${website.ga4PropertyId}. GSC nói người ta thấy gì trên Google; GA4 nói chuyện gì xảy ra sau khi họ bấm vào.`}
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
            <>
              {/* Bốn ô, và thứ tự là một phát biểu: ô ĐẦU là con số được tin,
                  ba ô sau là bối cảnh. Đặt "Người dùng" ở ô đầu — như trước
                  ngày 19/9/2026 — là dán nhãn người lên một con số mà hai phần
                  ba là client tự động. */}
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Phiên có tương tác</dt>
                  <dd className="text-2xl font-semibold">{totals.value.engagedSessions.toLocaleString("vi-VN")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Phiên thô</dt>
                  <dd className="text-2xl font-semibold text-muted-foreground">
                    {totals.value.sessions.toLocaleString("vi-VN")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Viewport 800×600</dt>
                  <dd className="text-2xl font-semibold text-muted-foreground">
                    {totals.value.headlessSessions.toLocaleString("vi-VN")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Lượt xem trang</dt>
                  <dd className="text-2xl font-semibold text-muted-foreground">
                    {totals.value.screenPageViews.toLocaleString("vi-VN")}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                <strong>Phiên có tương tác</strong> là con số đáng đọc: trên 10 giây, hoặc từ 2 lượt xem trang, hoặc có
                conversion. Ba số còn lại là bối cảnh, không phải thành tích.{" "}
                <strong>Viewport 800×600</strong> là kích thước cửa sổ mặc định của Chrome chạy headless — đo ngày
                19/9/2026, toàn bộ phiên loại này trên cả hai site đều có 0 tương tác. Nó chỉ bắt được client tự động
                nào chưa buồn đổi viewport, nên khoảng cách còn lại giữa hai số đầu vẫn là bot chưa lọc được, không
                phải người.
              </p>
            </>
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
                  <th className="py-1 text-right">Có tương tác</th>
                </tr>
              </thead>
              <tbody>
                {bySource.value.map((r) => (
                  <tr key={r.dimensionValue} className="border-t">
                    <td className="py-1 pr-3">{r.dimensionValue}</td>
                    <td className="py-1 pr-3 text-right">{r.sessions.toLocaleString("vi-VN")}</td>
                    <td className="py-1 text-right">{r.engagedSessions.toLocaleString("vi-VN")}</td>
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
                    <th className="py-1 pr-3 text-right">Có tương tác</th>
                    <th className="py-1 text-right">TG phiên TB</th>
                  </tr>
                </thead>
                <tbody>
                  {landing.value.slice(0, 30).map((r) => (
                    <tr key={r.path} className="border-t">
                      <td className="py-1 pr-3 font-mono">{r.path}</td>
                      <td className="py-1 pr-3 text-right">{r.sessions.toLocaleString("vi-VN")}</td>
                      <td className="py-1 pr-3 text-right">{r.engagedSessions.toLocaleString("vi-VN")}</td>
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
