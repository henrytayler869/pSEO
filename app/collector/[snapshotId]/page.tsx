import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, AlertTriangle, ShieldAlert, Info, FileSearch } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { getSnapshotDetail } from "@/lib/queries/collector";

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "BLOCK") {
    return (
      <Badge variant="secondary" className="bg-red-100 text-red-800 hover:bg-red-100">
        <ShieldAlert className="mr-1 h-3 w-3" /> CHẶN
      </Badge>
    );
  }
  if (severity === "WARN") {
    return (
      <Badge variant="secondary" className="bg-orange-100 text-orange-800 hover:bg-orange-100">
        <AlertTriangle className="mr-1 h-3 w-3" /> CẢNH BÁO
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Info className="mr-1 h-3 w-3" /> THÔNG TIN
    </Badge>
  );
}

export default async function SnapshotDetailPage({ params }: { params: Promise<{ snapshotId: string }> }) {
  const { snapshotId } = await params;
  const snapshot = await getSnapshotDetail(snapshotId);
  if (!snapshot) notFound();

  const run = snapshot.validationRuns[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link href="/collector" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại Thu thập dữ liệu
        </Link>
        <PageHeader
          icon={FileSearch}
          title={`${snapshot.source.name} — v${snapshot.version}`}
          description={`Lấy dữ liệu lúc ${snapshot.fetchedAt.toLocaleString()}`}
        />
      </div>

      {snapshot.status === "SUSPECT" && (
        <Alert className="border-orange-200 bg-orange-50">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <AlertTitle>Snapshot được đánh dấu Nghi ngờ — phát hiện sai lệch schema trong quá trình thu thập</AlertTitle>
          <AlertDescription>{snapshot.statusNote}</AlertDescription>
        </Alert>
      )}

      {!run && <p className="text-sm text-muted-foreground">Chưa được xác thực.</p>}

      {run && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Tổng số địa điểm</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{run.totalLocations}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Bị chặn</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-red-700">
                {run.blockedLocations} ({(run.blockRate * 100).toFixed(1)}%)
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Cảnh báo</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-orange-700">{run.warnLocations}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Cổng lô</CardTitle>
              </CardHeader>
              <CardContent>
                {run.batchGatePassed ? (
                  <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">
                    ĐẠT
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-red-100 text-red-800 hover:bg-red-100">
                    KHÔNG ĐẠT — lô bị chặn
                  </Badge>
                )}
              </CardContent>
            </Card>
          </div>

          {!run.batchGatePassed && (
            <Alert className="border-red-200 bg-red-50">
              <ShieldAlert className="h-4 w-4 text-red-600" />
              <AlertTitle>Cổng lô không đạt</AlertTitle>
              <AlertDescription>
                Tỷ lệ CHẶN ({(run.blockRate * 100).toFixed(1)}%) vượt ngưỡng cấu hình. Toàn bộ snapshot này bị
                chặn không cho tiếp tục sang bước dựng trang — không chỉ riêng các địa điểm bị gắn cờ.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Cờ xác thực</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mức độ</TableHead>
                    <TableHead>Quy tắc</TableHead>
                    <TableHead>Địa điểm</TableHead>
                    <TableHead>Thông báo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.flags.map((flag) => (
                    <TableRow key={flag.id}>
                      <TableCell>
                        <SeverityBadge severity={flag.severity} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{flag.rule}</TableCell>
                      <TableCell>
                        {flag.location.city ? `${flag.location.city}, ` : ""}
                        {flag.location.state} <span className="text-muted-foreground">{flag.location.zip}</span>
                      </TableCell>
                      <TableCell className="text-sm">{flag.message}</TableCell>
                    </TableRow>
                  ))}
                  {run.flags.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        Không có cờ nào — mọi địa điểm đều đạt.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
