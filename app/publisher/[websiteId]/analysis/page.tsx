import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { PublisherTabs } from "@/components/publisher-tabs";
import { WindowPicker } from "@/components/window-picker";
import { prisma } from "@/lib/db/prisma";
import { getGscTabData, getGaTabData, parseWindow } from "@/lib/queries/publisher-analytics";
import { fetchServedInventory } from "@/lib/publisher/inventory";
import { GOALS, isGoal } from "@/lib/publisher/recommend";
import { analysePages, type FindingKind } from "@/lib/publisher/analyse";

const KIND_LABEL: Record<FindingKind, string> = {
  "near-miss": "Sát trang 1",
  "low-ctr": "Có hạng, không ai bấm",
  "no-impressions": "Chưa có hiển thị",
  "thin-engagement": "Vào rồi thoát ngay",
};

export default async function AnalysisPage({
  params,
  searchParams,
}: {
  params: Promise<{ websiteId: string }>;
  searchParams: Promise<{ days?: string; goal?: string }>;
}) {
  const { websiteId } = await params;
  const sp = await searchParams;
  const days = parseWindow(sp.days);
  const goalRaw = sp.goal ?? null;
  const goal = isGoal(goalRaw) ? goalRaw : null;

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, name: true, url: true },
  });
  if (!website) notFound();

  const base = `/publisher/${websiteId}/analysis`;

  // Chưa chọn mục tiêu thì KHÔNG gọi API nào. Yêu cầu là "chọn mục tiêu trước
  // khi chạy phân tích", và tôn trọng nó theo nghĩa đen cũng tránh được việc
  // mỗi lần mở tab là một lượt quota Search Console tiêu đi cho không.
  const analysis = goal
    ? await (async () => {
        const [gsc, ga, inv] = await Promise.all([
          getGscTabData(websiteId, days),
          getGaTabData(websiteId, days),
          fetchServedInventory(website.url).then(
            (v) => v,
            () => null
          ),
        ]);
        return {
          result: analysePages(goal, {
            siteUrl: website.url,
            pages: gsc?.pages.ok ? gsc.pages.value : null,
            queries: gsc?.queries.ok ? gsc.queries.value : null,
            landing: ga?.landing.ok ? ga.landing.value : null,
            servedPaths: inv ? [...new Set(inv.byZip.values())] : null,
          }),
        };
      })()
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/publisher/${websiteId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại {website.name}
        </Link>
      </div>

      <PublisherTabs websiteId={websiteId} active="analysis" />

      <PageHeader
        icon={Target}
        title="Phân tích Data"
        description="Đọc GSC và GA4 cùng lúc, rồi nói SỬA TRANG NÀO. Mục tiêu quyết định tín hiệu nào chạy — một site đang lo được index không cần nghe về tỷ lệ nhấp."
      />

      <Card>
        <CardHeader>
          <CardTitle>Chọn mục tiêu</CardTitle>
          <CardDescription>
            Chưa chọn thì chưa chạy. Ba mục tiêu cho ba tập tín hiệu khác nhau, và trộn cả ba vào một danh sách dài là
            cách không việc nào được làm.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {GOALS.map((g) => (
              <Link
                key={g.id}
                href={`${base}?goal=${g.id}&days=${days}`}
                className={
                  g.id === goal
                    ? "rounded-lg border border-foreground px-3 py-2 text-sm font-medium"
                    : "rounded-lg border border-(--color-border-subtle) px-3 py-2 text-sm hover:bg-muted"
                }
              >
                {g.label}
              </Link>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {goal ? GOALS.find((g) => g.id === goal)?.hint : "Chọn một mục tiêu để chạy phân tích."}
          </p>
          {goal && <WindowPicker base={`${base}?goal=${goal}`} active={days} />}
        </CardContent>
      </Card>

      {analysis && (
        <>
          {analysis.result.unavailable.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tín hiệu không chạy được</CardTitle>
                <CardDescription>
                  Nêu ra thay vì bỏ qua: một nguồn hỏng mà im lặng trông giống hệt một site không có vấn đề nào.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-1 text-sm">
                  {analysis.result.unavailable.map((u) => (
                    <li key={u.signal}>
                      <strong>{u.signal}</strong> — {u.missing}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Việc nên làm, xếp theo tiềm năng đã đo</CardTitle>
              <CardDescription>
                Thứ tự theo số hiển thị hoặc số phiên THẬT của chính trang đó, không theo điểm ai đó gán. Mỗi dòng kèm
                con số để bạn kiểm được kết luận thay vì phải tin nó.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {analysis.result.findings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Không tín hiệu nào kêu cho mục tiêu này trong {days} ngày qua. Với một site mới, đó thường nghĩa là
                  chưa đủ dữ liệu chứ không phải mọi thứ đã tối ưu — xem lại sau vài tuần.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-3">#</th>
                        <th className="py-1 pr-3">Trang</th>
                        <th className="py-1 pr-3">Dấu hiệu</th>
                        <th className="py-1 pr-3">Số đo</th>
                        <th className="py-1">Nên làm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.result.findings.slice(0, 40).map((f, i) => (
                        <tr key={`${f.path}-${f.kind}`} className="border-t align-top">
                          <td className="py-1 pr-3 text-muted-foreground">{i + 1}</td>
                          <td className="py-1 pr-3 font-mono">{f.path}</td>
                          <td className="py-1 pr-3 whitespace-nowrap">{KIND_LABEL[f.kind]}</td>
                          <td className="py-1 pr-3 whitespace-nowrap">{f.evidence}</td>
                          <td className="py-1 text-muted-foreground">{f.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {analysis.result.findings.length > 40 && (
                    <p className="pt-2 text-xs text-muted-foreground">
                      … và {analysis.result.findings.length - 40} trang nữa.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Truy vấn có nhu cầu mà site chưa đứng được</CardTitle>
              <CardDescription>
                Đây là gợi ý NỘI DUNG CÒN THIẾU, không phải trang cần sửa: có người tìm, site có xuất hiện, nhưng ở quá
                xa để ai bấm.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {analysis.result.queryGaps.length === 0 ? (
                <p className="text-sm text-muted-foreground">Không có truy vấn nào đủ lượng hiển thị để kết luận.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Truy vấn</th>
                      <th className="py-1 pr-3 text-right">Hiển thị</th>
                      <th className="py-1 text-right">Hạng TB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.result.queryGaps.slice(0, 20).map((q) => (
                      <tr key={q.query} className="border-t">
                        <td className="py-1 pr-3">{q.query}</td>
                        <td className="py-1 pr-3 text-right">{q.impressions.toLocaleString("vi-VN")}</td>
                        <td className="py-1 text-right">{q.position.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
