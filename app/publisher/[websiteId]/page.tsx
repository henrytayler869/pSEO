import { Badge } from "@/components/ui/badge";
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
import { WpAdminLinkCell } from "@/components/wp-admin-link";
import { SitemapSubmit } from "@/components/sitemap-submit";

export default async function WebsiteDetailPage({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const detail = await getWebsiteDetail(websiteId);
  if (!detail) notFound();

  const { website, domain, wpAdmin, requiredPages, requiredPagesError, sitemaps, sitemapsError, sitemapCount, sitemapError, postCount, postCountError, search, topPages, gscError, traffic, trafficBySource, ga4Error } = detail;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/publisher" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại Publisher
        </Link>
      </div>

      <div className="flex gap-1 border-b">
        <span className="border-b-2 border-foreground px-3 py-2 text-sm font-medium">Tổng quan</span>
        <Link
          href={`/publisher/${website.id}/onpage`}
          className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          OnPage
        </Link>
        <Link
          href={`/publisher/${websiteId}/posts`}
          className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Bài viết
        </Link>
        <Link
          href={`/publisher/${websiteId}/articles`}
          className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Tạo bài viết
        </Link>
      </div>

      <PageHeader
        icon={Globe}
        title={website.name}
        description={
          <>
            {website.url} · GSC: {website.gscPropertyUrl} · GA4: {website.ga4PropertyId}
            {" · Domain: "}
            {domain ? (
              <Link href="/domains" className="underline underline-offset-2">
                {domain.name} ({domain.cloudflareError ? "lỗi Cloudflare" : (domain.cloudflareStatus ?? "chưa rõ")})
              </Link>
            ) : (
              <span className="text-amber-700">
                chưa đăng ký ở mục Domain — không kiểm được DNS/Cloudflare từ đây
              </span>
            )}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>
            Trang bắt buộc
            {requiredPages && ` (${requiredPages.filter((p) => p.status === "ok").length}/${requiredPages.length})`}
          </CardTitle>
          <CardDescription>
            Danh sách này là hợp đồng chung cho mọi publisher, lấy từ /api/v1/content-rules — publisher mới thừa hưởng
            mà không phải tự cài phép kiểm nào. HQ kiểm từ bên ngoài bằng cách gọi thẳng URL, nên không có gì để quên.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requiredPagesError ? (
            <p className="text-sm text-red-700">{requiredPagesError}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(requiredPages ?? []).map((p) => (
                <li key={p.id} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={p.status === "ok" ? "outline" : "destructive"}>
                      {p.status === "ok" ? "có" : p.status === "missing" ? "THIẾU" : "chưa rõ"}
                    </Badge>
                    <span className="font-medium">{p.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.foundAt ?? p.tried.join(" | ")}
                    </span>
                    {p.status === "ok" && p.linkedFrom === false && (
                      <Badge variant="destructive">không ai link tới</Badge>
                    )}
                  </div>
                  {p.status !== "ok" && <p className="text-xs text-muted-foreground">{p.why}</p>}
                  {p.status !== "ok" && <p className="font-mono text-xs text-muted-foreground">{p.detail}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sitemap trên Search Console</CardTitle>
          <CardDescription>
            Đây là thứ Search Console ĐANG GIỮ, khác với sitemap site đang phục vụ. Nộp là việc làm một lần cho mỗi
            property; nộp lại chỉ cập nhật chứ không tạo bản trùng. Google trả 200 ngay khi nhận, nhưng phải vài giờ
            tới vài ngày mới đọc xong — số URL và số lỗi bên dưới chỉ có nghĩa sau lúc đó.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SitemapSubmit websiteId={website.id} siteUrl={website.url} sitemaps={sitemaps} error={sitemapsError} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WordPress Admin</CardTitle>
          <CardDescription>
            Địa chỉ suy ra từ REST API base của site, KHÔNG từ URL công khai — với site headless thì URL công khai phục
            vụ Next.js và không hề có /wp-admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WpAdminLinkCell link={wpAdmin} />
        </CardContent>
      </Card>

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="URL trong sitemap"
          value={sitemapCount ? sitemapCount.total.toLocaleString() : "—"}
          error={sitemapError}
          note={
            sitemapCount
              ? sitemapCount.breakdown.map((b) => `${b.label}: ${b.count}`).join(" · ")
              : undefined
          }
        />
        <StatCard
          label="Bài blog (WordPress)"
          value={postCount !== null ? postCount.toLocaleString() : "—"}
          error={postCountError}
          note="Chỉ đếm bài WordPress. Không phải số trang của site — trang thị trường do Next.js dựng, không nằm trong WordPress."
        />
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

function StatCard({
  label,
  value,
  error,
  note,
}: {
  label: string;
  value: string;
  error: string | null;
  /** What the number actually counts. Shown always, not on hover: a figure whose
   * scope is only discoverable by hovering is a figure that gets quoted without
   * its scope. */
  note?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{error ? "—" : value}</div>
        {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
        {!error && note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
      </CardContent>
    </Card>
  );
}
