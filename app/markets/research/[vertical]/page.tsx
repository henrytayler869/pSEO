import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { getTrafficRankedMarkets } from "@/lib/queries/traffic-research";
import { formatVertical, formatNumber } from "@/lib/format";

export default async function TrafficVerticalPage({ params }: { params: Promise<{ vertical: string }> }) {
  const { vertical } = await params;
  const rows = await getTrafficRankedMarkets(vertical);
  if (rows.length === 0) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/markets?tab=research" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Nghiên cứu niche
        </Link>
      </div>
      <PageHeader
        icon={Sparkles}
        title={formatVertical(vertical)}
        description={`Xếp hạng theo điểm tiềm năng traffic (search volume × CPC / độ khó) trên ${rows.length} thị trường thật — chưa gắn giá trị kỳ vọng thật vì chưa có mạng lưới pay-per-call cho niche này.`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Bảng xếp hạng</CardTitle>
          <CardDescription>Thị trường chưa có số liệu từ khóa sẽ hiện &ldquo;—&rdquo; và xếp cuối bảng.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Thị trường</TableHead>
                <TableHead>Lượng tìm kiếm</TableHead>
                <TableHead>Độ khó (KD)</TableHead>
                <TableHead>CPC</TableHead>
                <TableHead>Điểm traffic</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.marketIdentityId}>
                  <TableCell>
                    {r.city ? `${r.city}, ${r.state}` : r.state} <span className="text-muted-foreground">{r.zip}</span>
                  </TableCell>
                  <TableCell>{r.searchVolume !== null ? formatNumber(r.searchVolume) : "—"}</TableCell>
                  <TableCell>{r.keywordDifficulty !== null ? r.keywordDifficulty.toFixed(0) : "—"}</TableCell>
                  <TableCell>{r.cpc !== null ? `$${r.cpc.toFixed(2)}` : "—"}</TableCell>
                  <TableCell className="font-medium">{r.score !== null ? r.score.toFixed(1) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
