import Link from "next/link";
import { ArrowLeft, AlertTriangle, BarChart3 } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { PricingModelBadge } from "@/components/pricing-model-badge";
import { getCoverageImports, getRankedMarkets, getVerticalSummaries } from "@/lib/queries/market-explorer";
import { formatVertical, formatUsd, formatNumber } from "@/lib/format";
import { notFound } from "next/navigation";

export default async function VerticalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ vertical: string }>;
  searchParams: Promise<{ import?: string }>;
}) {
  const { vertical } = await params;
  const { import: importIdParam } = await searchParams;

  const imports = await getCoverageImports();
  if (imports.length === 0) notFound();
  const coverageImportId = importIdParam ?? imports[0].id;

  const summaries = await getVerticalSummaries(coverageImportId);
  const summary = summaries.find((s) => s.vertical === vertical);
  if (!summary) notFound();

  const rows = await getRankedMarkets(coverageImportId, vertical);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={`/markets?import=${coverageImportId}&tab=overview`} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại Thị trường
        </Link>
        <PageHeader
          icon={BarChart3}
          title={formatVertical(vertical)}
          description={
            <>
              {summary.marketCount} thị trường trong lần nhập này · xếp hạng theo MarketScore (payoutFloor × tỷ lệ
              chuyển đổi ước tính × lượng tìm kiếm ÷ chỉ số độ khó)
            </>
          }
        />
        <PricingModelBadge model={summary.pricingModel} />
      </div>

      {summary.isFlatRate && (
        <Alert className="border-orange-200 bg-orange-50">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <AlertTitle>Ngành này trả mức giá cố định trên mọi mã zip</AlertTitle>
          <AlertDescription>
            Mọi thị trường đều có cùng payoutFloor, nên việc xếp hạng theo giá ở đây không có ý nghĩa — nó không mang
            lại thông tin gì. Cột giá đã được ẩn bên dưới. Đòn bẩy thực sự duy nhất cho ngành này là lượng tìm kiếm so
            với độ khó từ khóa; đó chính là những gì MarketScore quy về trong trường hợp này.
          </AlertDescription>
        </Alert>
      )}

      {summary.correlation?.isTrap && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Giá và độ khó từ khóa có tương quan (r = {summary.correlation.correlation!.toFixed(2)})</AlertTitle>
          <AlertDescription>
            Những thị trường trả giá cao nhất trong ngành này cũng thường là những thị trường khó xếp hạng nhất. Một
            payoutFloor cao ở đây không phải là tiền miễn phí — hãy kiểm tra cột KD trước khi dồn công sức xây dựng
            vào các thị trường trả giá cao nhất.
          </AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Thị trường</TableHead>
              {!summary.isFlatRate && <TableHead className="text-right">Giá sàn</TableHead>}
              <TableHead className="text-right">Lượng tìm kiếm</TableHead>
              <TableHead className="text-right">Độ khó (KD)</TableHead>
              <TableHead className="text-right">CPC</TableHead>
              <TableHead className="text-right">Điểm số</TableHead>
              <TableHead className="text-right">Tỷ lệ chuyển đổi (giả định)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={row.marketId}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell>
                  {row.city}, {row.state} <span className="text-muted-foreground">{row.zip}</span>
                </TableCell>
                {!summary.isFlatRate && <TableCell className="text-right">{formatUsd(row.payoutFloor)}</TableCell>}
                <TableCell className="text-right">{row.searchVolume !== null ? formatNumber(row.searchVolume) : "—"}</TableCell>
                <TableCell className="text-right">{row.keywordDifficulty !== null ? row.keywordDifficulty.toFixed(0) : "—"}</TableCell>
                <TableCell className="text-right">{row.cpc !== null ? formatUsd(row.cpc) : "—"}</TableCell>
                <TableCell className="text-right font-medium">{row.score !== null ? formatNumber(row.score) : "chưa chấm điểm"}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {row.estConversionRateInput !== null ? `${(row.estConversionRateInput * 100).toFixed(0)}%` : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        payoutFloor là mức giá sàn do mạng lưới công bố, không phải là mức giá thực tế được đảm bảo. Tỷ lệ chuyển đổi
        là một giả định được cấu hình theo từng ngành (xem AppConfig), không phải dữ liệu đo lường thực tế — mỗi dòng
        điểm số đều lưu lại chính xác các đầu vào của nó để truy vết.
      </p>
    </div>
  );
}
