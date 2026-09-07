import Link from "next/link";
import { AlertTriangle, TrendingUp, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { PricingModelBadge } from "@/components/pricing-model-badge";
import { ImportPicker } from "@/components/import-picker";
import { DiffPicker } from "@/components/diff-picker";
import { NicheResearchForm } from "@/components/niche-research-form";
import { SuggestedNicheRow } from "@/components/suggested-niche-row";
import { RunAllSuggestedNichesForm } from "@/components/run-all-suggested-niches-form";
import { TrafficTrendViewer } from "@/components/traffic-trend-viewer";
import { MarketsTabs } from "@/components/markets-tabs";
import { getCoverageImports, getVerticalSummaries } from "@/lib/queries/market-explorer";
import { getTrafficVerticalSummaries, getTrafficScoreTrend } from "@/lib/queries/traffic-research";
import { getSuggestedNiches } from "@/lib/markets/candidate-niches";
import { diffCoverageImports } from "@/lib/coverage/diff";
import { formatVertical, formatNumber, formatUsd } from "@/lib/format";

const CHANGE_LABELS: Record<string, string> = {
  GAINED: "Được thêm",
  LOST: "Bị mất",
  PAYOUT_CHANGED: "Đổi giá",
  UNCHANGED: "Không đổi",
};

// Coverage Diff only means something once a real network/coverage-import
// relationship exists — temporarily hidden until then (see README "No
// manual data-import UI"). Flip this back on when that day comes; nothing
// else below needs to change.
const SHOW_DIFF_TAB = false;

export default async function MarketExplorerPage({
  searchParams,
}: {
  searchParams: Promise<{ import?: string; older?: string; newer?: string; tab?: string }>;
}) {
  const { import: importIdParam, older, newer } = await searchParams;
  const [imports, trafficSummaries, suggestions] = await Promise.all([
    getCoverageImports(),
    getTrafficVerticalSummaries(),
    getSuggestedNiches(),
  ]);

  if (imports.length === 0 && trafficSummaries.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={TrendingUp}
          title="Thị trường"
          description="Xếp hạng theo giá trị kỳ vọng trong từng ngành. Các ngành không bao giờ được so sánh với nhau trong cùng một bảng — vì thang giá và độ khó chuyển đổi khác biệt quá lớn để việc so sánh có ý nghĩa."
        />
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Chưa có dữ liệu thị trường nào</AlertTitle>
          <AlertDescription>
            Chưa có mạng lưới pay-per-call thì bắt đầu ở tab &ldquo;Nghiên cứu niche&rdquo; bên dưới — chấm điểm
            theo tiềm năng traffic thuần túy, không cần file coverage.
          </AlertDescription>
        </Alert>
        <MarketsTabs
          showDiff={SHOW_DIFF_TAB}
          overview={<p className="text-sm text-muted-foreground">Chưa có gì để xem — bắt đầu ở tab Nghiên cứu niche.</p>}
          research={<NicheResearchTabContent suggestions={suggestions} summaries={[]} />}
          trend={<p className="text-sm text-muted-foreground">Chưa có niche nào được nghiên cứu để xem xu hướng.</p>}
          diff={<p className="text-sm text-muted-foreground">Cần ít nhất hai lần nhập vùng phủ thật để so sánh.</p>}
        />
      </div>
    );
  }

  const coverageImportId = imports.length > 0 ? (importIdParam ?? imports[0].id) : null;
  const [payoutSummaries, trendEntries] = await Promise.all([
    coverageImportId ? getVerticalSummaries(coverageImportId) : Promise.resolve([]),
    Promise.all(trafficSummaries.map(async (s) => [s.vertical, await getTrafficScoreTrend(s.vertical)] as const)),
  ]);
  const trendsByVertical = Object.fromEntries(trendEntries);

  const diffEnabled = SHOW_DIFF_TAB && imports.length >= 2;
  let diffContent = (
    <p className="text-sm text-muted-foreground">
      Cần ít nhất hai lần nhập vùng phủ thật để so sánh — hiện có {imports.length}.
    </p>
  );
  if (diffEnabled) {
    const newerId = newer ?? imports[0].id;
    const olderId = older ?? imports[1].id;
    const diff = await diffCoverageImports(olderId, newerId);
    const changedRows = diff.rows.filter((r) => r.change !== "UNCHANGED");

    diffContent = (
      <div className="flex flex-col gap-6">
        <DiffPicker
          imports={imports.map((i) => ({ id: i.id, fileName: i.fileName, importedAt: i.importedAt.toISOString() }))}
          olderId={olderId}
          newerId={newerId}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {diff.byVertical.map((v) => (
            <Card key={v.vertical}>
              <CardHeader>
                <CardTitle className="text-base">{formatVertical(v.vertical)}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vùng phủ</span>
                  <span>
                    {v.oldZipCount} → {v.newZipCount} mã zip
                  </span>
                </div>
                {v.gained > 0 && (
                  <Badge variant="secondary" className="w-fit bg-green-100 text-green-800 hover:bg-green-100">
                    +{v.gained} được thêm
                  </Badge>
                )}
                {v.lost > 0 && (
                  <Badge variant="destructive" className="w-fit">
                    -{v.lost} bị mất
                  </Badge>
                )}
                {v.payoutChanged > 0 && (
                  <Badge variant="secondary" className="w-fit bg-blue-100 text-blue-800 hover:bg-blue-100">
                    {v.payoutChanged} thay đổi giá (TB {v.avgPayoutDeltaPct! >= 0 ? "+" : ""}
                    {v.avgPayoutDeltaPct!.toFixed(1)}%)
                  </Badge>
                )}
                {v.gained === 0 && v.lost === 0 && v.payoutChanged === 0 && (
                  <span className="text-xs text-muted-foreground">Không có thay đổi</span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="overflow-x-auto rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Thay đổi</TableHead>
                <TableHead>Ngành</TableHead>
                <TableHead>Thị trường</TableHead>
                <TableHead className="text-right">Giá cũ</TableHead>
                <TableHead className="text-right">Giá mới</TableHead>
                <TableHead className="text-right">Chênh lệch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changedRows.map((row) => (
                <TableRow key={`${row.zip}-${row.vertical}`}>
                  <TableCell>
                    <Badge
                      variant={row.change === "LOST" ? "destructive" : "secondary"}
                      className={
                        row.change === "GAINED"
                          ? "bg-green-100 text-green-800 hover:bg-green-100"
                          : row.change === "LOST"
                            ? undefined
                            : "bg-blue-100 text-blue-800 hover:bg-blue-100"
                      }
                    >
                      {CHANGE_LABELS[row.change] ?? row.change}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatVertical(row.vertical)}</TableCell>
                  <TableCell>
                    {row.city}, {row.state} <span className="text-muted-foreground">{row.zip}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {row.oldPayoutFloor !== undefined ? formatUsd(row.oldPayoutFloor) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.newPayoutFloor !== undefined ? formatUsd(row.newPayoutFloor) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.payoutDeltaPct !== undefined
                      ? `${row.payoutDeltaPct >= 0 ? "+" : ""}${row.payoutDeltaPct.toFixed(1)}%`
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {changedRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    Không có khác biệt giữa hai lần nhập này.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={TrendingUp}
        title="Thị trường"
        description="Xếp hạng theo giá trị kỳ vọng trong từng ngành, nghiên cứu niche mới, và xem xu hướng traffic theo thời gian — tất cả trong một chỗ."
      />

      <MarketsTabs
        showDiff={SHOW_DIFF_TAB}
        overview={
          <div className="flex flex-col gap-8">
            {coverageImportId && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                    Ngành có mạng lưới trả tiền
                  </h2>
                  {imports.length > 1 && (
                    <ImportPicker
                      imports={imports.map((i) => ({
                        id: i.id,
                        fileName: i.fileName,
                        network: i.network,
                        importedAt: i.importedAt.toISOString(),
                        rowCount: i.rowCount,
                      }))}
                      currentId={coverageImportId}
                    />
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {payoutSummaries.map((summary) => (
                    <Link key={summary.vertical} href={`/markets/${summary.vertical}?import=${coverageImportId}`}>
                      <Card className="h-full transition-shadow hover:shadow-md">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{formatVertical(summary.vertical)}</CardTitle>
                            <PricingModelBadge model={summary.pricingModel} />
                          </div>
                          <CardDescription>
                            {summary.marketCount} thị trường · {summary.scoredMarketCount} đã chấm điểm
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-2">
                          {summary.isFlatRate && (
                            <Badge variant="secondary" className="w-fit bg-orange-100 text-orange-800 hover:bg-orange-100">
                              Ngành trả giá cố định — đã ẩn xếp hạng theo giá
                            </Badge>
                          )}
                          {summary.correlation?.isTrap && (
                            <Badge variant="destructive" className="w-fit">
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              Bẫy tương quan Giá/Độ khó từ khóa (r = {summary.correlation.correlation!.toFixed(2)})
                            </Badge>
                          )}
                          {summary.topScore !== null && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <TrendingUp className="h-3.5 w-3.5" />
                              Điểm cao nhất: {formatNumber(summary.topScore)}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {trafficSummaries.length > 0 && (
              <div className="flex flex-col gap-4">
                <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                  Ngành đang nghiên cứu traffic (chưa có mạng lưới) — xếp theo điểm, tốt nhất trước
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {trafficSummaries.map((summary) => (
                    <Link key={summary.vertical} href={`/markets/research/${summary.vertical}`}>
                      <Card className={summary.rank === 1 ? "h-full ring-2 ring-primary transition-shadow hover:shadow-md" : "h-full transition-shadow hover:shadow-md"}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{formatVertical(summary.vertical)}</CardTitle>
                            <Badge variant="outline" className="gap-1">
                              <Sparkles className="h-3 w-3" /> {summary.rank === 1 ? "🏆 Tốt nhất" : `Traffic #${summary.rank ?? "—"}`}
                            </Badge>
                          </div>
                          <CardDescription>
                            {summary.marketCount} thị trường · {summary.scoredMarketCount} đã chấm điểm
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-1">
                          {summary.avgScore !== null && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <TrendingUp className="h-3.5 w-3.5" />
                              Điểm trung bình: {formatNumber(summary.avgScore)}
                            </div>
                          )}
                          {summary.avgCpc !== null && (
                            <p className="text-xs text-muted-foreground">
                              CPC TB ${summary.avgCpc.toFixed(2)} · Độ khó TB {summary.avgKeywordDifficulty?.toFixed(0)}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
        research={<NicheResearchTabContent suggestions={suggestions} summaries={trafficSummaries} />}
        trend={
          <Card>
            <CardHeader>
              <CardTitle>Xu hướng điểm traffic theo thời gian</CardTitle>
              <CardDescription>
                Điểm trung bình mỗi ngày chạy nghiên cứu, gộp theo toàn bộ thị trường trong một niche. Cần chạy một
                niche nhiều lần theo thời gian (thủ công hoặc qua{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">scripts/run-scheduled-niche-research.ts</code>
                ) mới có đủ điểm để so sánh.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TrafficTrendViewer trendsByVertical={trendsByVertical} />
            </CardContent>
          </Card>
        }
        diff={diffContent}
      />
    </div>
  );
}

function NicheResearchTabContent({
  suggestions,
  summaries,
}: {
  suggestions: Awaited<ReturnType<typeof getSuggestedNiches>>;
  summaries: Awaited<ReturnType<typeof getTrafficVerticalSummaries>>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Gợi ý niche tiếp theo</CardTitle>
          <CardDescription>
            Danh sách niche có tiềm năng lead-gen/pay-per-call thật, mỗi niche kèm nguồn dữ liệu công khai có thể
            gắn vào — không phải AI đoán. Niche đã nghiên cứu (dù qua đây hay qua coverage import thật) tự động biến
            mất khỏi danh sách này. Chỉnh sửa danh sách qua AppConfig key{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">candidateNiches</code>. Chạy định kỳ 2 tuần/lần
            qua <code className="rounded bg-muted px-1 py-0.5 text-xs">scripts/run-scheduled-niche-research.ts</code>{" "}
            (xem README) để tự động xử lý dần danh sách này mà không cần bấm tay.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 border-b pb-3">
            <RunAllSuggestedNichesForm count={suggestions.length} />
            {suggestions.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Chạy lần lượt từng niche trong danh sách bên dưới — mỗi niche gọi DataForSEO một lần cho mỗi zip thật
                hiện có, nên chi phí cộng dồn theo số niche. Một niche lỗi (ví dụ chưa cấu hình DataForSEO) không làm
                dừng các niche còn lại.
              </p>
            )}
          </div>
          {suggestions.map((s) => (
            <SuggestedNicheRow key={s.vertical} vertical={s.vertical} label={s.label} rationale={s.rationale} />
          ))}
          {suggestions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Đã nghiên cứu hết danh sách gợi ý hiện tại — thêm niche mới vào AppConfig key{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">candidateNiches</code>, hoặc tự nhập ở dưới.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tự nhập niche khác</CardTitle>
          <CardDescription>
            Cho niche không có trong danh sách gợi ý. Một lần bấm: tạo thị trường trên mọi zip thật → lấy số liệu từ
            khóa (DataForSEO) → tính điểm traffic.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NicheResearchForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>So sánh các niche đã nghiên cứu</CardTitle>
          <CardDescription>
            Tự động xếp hạng theo điểm trung bình (giảm dần) — niche tốt nhất luôn ở trên cùng, có đánh dấu 🏆. Đọc
            thêm 3 cột CPC/độ khó/lượng tìm kiếm trước khi quyết định — điểm tổng có thể giống nhau vì lý do khác
            nhau. Bấm vào một niche để xem chi tiết theo từng zip.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hạng</TableHead>
                <TableHead>Niche</TableHead>
                <TableHead>Điểm TB</TableHead>
                <TableHead>CPC TB</TableHead>
                <TableHead>Độ khó TB</TableHead>
                <TableHead>Tổng lượng tìm kiếm</TableHead>
                <TableHead>Đã có điểm</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map((s) => (
                <TableRow key={s.vertical} className={s.rank === 1 ? "bg-primary/5" : undefined}>
                  <TableCell className="font-medium">{s.rank === 1 ? "🏆 #1" : s.rank !== null ? `#${s.rank}` : "—"}</TableCell>
                  <TableCell className="font-medium">{formatVertical(s.vertical)}</TableCell>
                  <TableCell>{s.avgScore !== null ? s.avgScore.toFixed(1) : "—"}</TableCell>
                  <TableCell>{s.avgCpc !== null ? `$${s.avgCpc.toFixed(2)}` : "—"}</TableCell>
                  <TableCell>{s.avgKeywordDifficulty !== null ? s.avgKeywordDifficulty.toFixed(0) : "—"}</TableCell>
                  <TableCell>{s.totalSearchVolume !== null ? formatNumber(s.totalSearchVolume) : "—"}</TableCell>
                  <TableCell>
                    {s.scoredMarketCount}/{s.marketCount}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/markets/research/${s.vertical}`}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Xem chi tiết
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {summaries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    Chưa có niche nào được nghiên cứu.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
