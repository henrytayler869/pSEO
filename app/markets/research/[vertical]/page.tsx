import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { getTrafficRankedMarkets } from "@/lib/queries/traffic-research";
import { formatVertical } from "@/lib/format";
import { NicheMarketTable } from "@/components/niche-market-table";

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
          <CardDescription>Bấm vào một thị trường để xem từng từ khoá của nó. Thị trường chưa có số liệu từ khóa sẽ hiện &ldquo;—&rdquo; và xếp cuối bảng.</CardDescription>
        </CardHeader>
        <CardContent>
          <NicheMarketTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
