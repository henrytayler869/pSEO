import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { getWebsiteDetail } from "@/lib/queries/publisher";
import { MeasurementIdForm } from "@/components/measurement-id-form";
import { RevalidateSecretForm } from "@/components/revalidate-secret-form";

export default async function WebsiteDetailPage({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const detail = await getWebsiteDetail(websiteId);
  if (!detail) notFound();

  const { website, postCount, postCountError, search, topPages, gscError, traffic, trafficBySource, ga4Error } = detail;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/publisher" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại Publisher
        </Link>
      </div>

      <PageHeader
        icon={Globe}
        title={website.name}
        description={
          <>
            {website.url} · GSC: {website.gscPropertyUrl} · GA4: {website.ga4PropertyId}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Mã đo GA4</CardTitle>
          <CardDescription>
            Đây là mã site dùng để GỬI sự kiện (G-XXXXXXXXXX), khác với GA4 property ID ở trên vốn dùng để ĐỌC báo cáo.
            Lưu ở đây thì site tự lấy qua Head Quarter, không phải sửa file trên máy chủ. Giá trị được nhúng lúc build,
            nên nó có hiệu lực từ lần build kế tiếp — restart không đủ.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MeasurementIdForm websiteId={website.id} current={website.ga4MeasurementId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revalidate secret</CardTitle>
          <CardDescription>
            Dùng để BÁO NGAY cho site khi đổi thiết lập ở đây. Không có nó, site vẫn tự lấy giá trị mới nhưng phải chờ
            cache hết hạn — HTML nằm ở Cloudflare tới 24 giờ, đủ để người vừa đổi tưởng là hỏng. Giá trị phải khớp
            REVALIDATE_SECRET trong .env.production của site. Bấm Lưu sẽ dùng thử nó ngay và báo site trả lời gì.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/*
            Chỉ truyền boolean sang client — giá trị đã lưu không bao giờ rời khỏi máy chủ.

            Boolean(...) chứ KHÔNG phải `!== null`. Trường này có thể là
            undefined chứ không phải null: một Prisma Client sinh ra trước khi
            cột tồn tại sẽ không chọn nó, và `undefined !== null` cho ra true —
            nhãn sẽ báo "đã đặt" cho một secret không hề tồn tại. Đã xảy ra
            đúng như vậy ngay khi thêm ô này. Chuỗi rỗng cũng vậy: nó không
            phải một secret dùng được, nên không được đọc là "đã đặt".
          */}
          <RevalidateSecretForm websiteId={website.id} hasSecret={Boolean(website.revalidateSecret)} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Bài viết (WordPress)" value={postCount !== null ? postCount.toLocaleString() : "—"} error={postCountError} />
        <StatCard
          label="Clicks / Impressions (28 ngày)"
          value={search ? `${search.clicks.toLocaleString()} / ${search.impressions.toLocaleString()}` : "—"}
          error={gscError}
        />
        <StatCard label="Active users (28 ngày)" value={traffic ? traffic.activeUsers.toLocaleString() : "—"} error={ga4Error} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tìm kiếm (Google Search Console)</CardTitle>
          <CardDescription>28 ngày gần nhất, xếp theo click. Vị trí trung bình toàn site: {search ? search.avgPosition.toFixed(1) : "—"}.</CardDescription>
        </CardHeader>
        <CardContent>
          {gscError ? (
            <Alert className="border-red-200 bg-red-50">
              <AlertTitle>Không lấy được dữ liệu GSC</AlertTitle>
              <AlertDescription>{gscError}</AlertDescription>
            </Alert>
          ) : topPages && topPages.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trang</TableHead>
                  <TableHead>Clicks</TableHead>
                  <TableHead>Impressions</TableHead>
                  <TableHead>CTR</TableHead>
                  <TableHead>Vị trí TB</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topPages.map((p) => (
                  <TableRow key={p.page}>
                    <TableCell className="max-w-md truncate" title={p.page}>
                      {p.page}
                    </TableCell>
                    <TableCell>{p.clicks.toLocaleString()}</TableCell>
                    <TableCell>{p.impressions.toLocaleString()}</TableCell>
                    <TableCell>{(p.ctr * 100).toFixed(1)}%</TableCell>
                    <TableCell>{p.position.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu click/impression trong khoảng thời gian này.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Traffic (Google Analytics 4)</CardTitle>
          <CardDescription>
            28 ngày gần nhất. Sessions: {traffic ? traffic.sessions.toLocaleString() : "—"} · Pageviews:{" "}
            {traffic ? traffic.screenPageViews.toLocaleString() : "—"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ga4Error ? (
            <Alert className="border-red-200 bg-red-50">
              <AlertTitle>Không lấy được dữ liệu GA4</AlertTitle>
              <AlertDescription>{ga4Error}</AlertDescription>
            </Alert>
          ) : trafficBySource && trafficBySource.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kênh</TableHead>
                  <TableHead>Sessions</TableHead>
                  <TableHead>Active users</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trafficBySource.map((r) => (
                  <TableRow key={r.dimensionValue}>
                    <TableCell>{r.dimensionValue}</TableCell>
                    <TableCell>{r.sessions.toLocaleString()}</TableCell>
                    <TableCell>{r.activeUsers.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu traffic trong khoảng thời gian này.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, error }: { label: string; value: string; error: string | null }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{error ? "—" : value}</div>
        {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
      </CardContent>
    </Card>
  );
}
