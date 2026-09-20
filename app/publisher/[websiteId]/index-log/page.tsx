import Link from "next/link";
import { PublisherTabs, PublisherSubTabs, gscSubTabs } from "@/components/publisher-tabs";
import { notFound } from "next/navigation";
import { ArrowLeft, Activity, AlertTriangle, Timer } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getIndexLog } from "@/lib/indexing/log";
import { getRecheckStatus, RECHECK_INTERVAL_HOURS, HEARTBEAT_HOURS } from "@/lib/indexing/schedule";
import { RecheckButton, RecordManualForm } from "@/components/index-log-forms";

const ARM_LABEL: Record<string, string> = {
  submitted: "Đã gửi Omega",
  control: "Đối chứng — cố tình KHÔNG gửi",
  manual: "Bấm tay trong Search Console",
};

/** Nhãn tiếng Việt cho coverageState, giữ nguyên chuỗi gốc khi chưa biết.
 * Dịch bừa một trạng thái lạ nguy hiểm hơn là để nguyên tiếng Anh. */
function stateLabel(s: string): string {
  if (s.includes("Submitted and indexed")) return "Đã index";
  if (s.includes("Crawled - currently not indexed")) return "Đã đọc, chưa lấy";
  if (s.includes("Discovered - currently not indexed")) return "Đã biết, chưa đọc";
  if (s.includes("unknown to Google")) return "Google chưa biết";
  return s;
}

export default async function IndexLogPage({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const website = await prisma.website.findUnique({ where: { id: websiteId }, select: { id: true, name: true, url: true } });
  if (!website) notFound();

  const { rows, arms, daysElapsed } = await getIndexLog(websiteId, website.url);
  const schedule = await getRecheckStatus(websiteId);
  const neverChecked = rows.filter((r) => r.checkCount === 0).length;
  const dropped = rows.filter((r) => r.droppedOut);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/publisher/${websiteId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại {website.name}
        </Link>
      </div>

      <PublisherTabs websiteId={websiteId} active="gsc" />
      <PublisherSubTabs items={gscSubTabs(websiteId)} active="index-log" />

      <PageHeader
        icon={Activity}
        title="Theo dõi index"
        description="Mỗi lần đo ghi thêm một dòng, không ghi đè. Câu hỏi đáng theo dõi là URL đi theo hướng nào, không phải hôm nay nó thế nào."
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Chưa theo dõi URL nào. Gửi lô Omega (<code>npm run omega:submit</code>) hoặc ghi mốc bấm tay bên dưới.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">So sánh các nhánh</CardTitle>
            <CardDescription>
              Đã {daysElapsed.toFixed(1)} ngày kể từ URL đầu tiên vào theo dõi.
              {daysElapsed < 3 && " Dưới 3 ngày thì chênh lệch giữa các nhánh là nhiễu, chưa phải tín hiệu."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nhánh</TableHead>
                  <TableHead className="text-right">URL</TableHead>
                  <TableHead className="text-right">Đã index</TableHead>
                  <TableHead className="text-right">Đã đọc, chưa lấy</TableHead>
                  <TableHead className="text-right">Chưa đọc</TableHead>
                  <TableHead className="text-right">Chưa đo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {arms.map((a) => (
                  <TableRow key={`${a.arm}|${a.provider}`}>
                    <TableCell className="font-medium">{ARM_LABEL[a.arm] ?? a.arm}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.total}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{a.indexedNow}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.crawledNotIndexed}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.neverCrawled}</TableCell>
                    {/* "Chưa đo" đứng riêng, không gộp vào "chưa index": gộp
                        biến một phép đo chưa chạy thành một kết luận về Google. */}
                    <TableCell className="text-right tabular-nums text-muted-foreground">{a.neverChecked}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {neverChecked === rows.length && rows.length > 0 && (
              <p className="rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                Chưa đo lần nào — mọi cột trạng thái đang trống vì chưa ai hỏi Google, không phải vì Google trả lời là chưa index.
              </p>
            )}

            {dropped.length > 0 && (
              <p className="rounded-md border border-red-500/50 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-300">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                {dropped.length} URL từng vào chỉ mục rồi RƠI RA: {dropped.slice(0, 3).map((d) => d.path).join(", ")}
                {dropped.length > 3 && "…"}. Chỉ thấy được nhờ giữ log từng lần đo.
              </p>
            )}

            <RecheckButton websiteId={websiteId} count={rows.length} />
          </CardContent>
        </Card>
      )}

      {/*
        Pipeline thay cho routine bấm tay.

        Ba câu KHÁC NHAU, và gộp chúng lại là cách một lịch chạy chết mà không
        ai biết: "đo lần cuối lúc nào", "nhịp tim còn đập không", "tới hạn
        chưa". Một màn hình chỉ hiện câu đầu sẽ trông y hệt nhau dù timer đã
        dừng ba tuần — đúng kiểu hỏng của routine mà pipeline này thay thế.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Timer className="h-4 w-4" /> Đo lại tự động
          </CardTitle>
          <CardDescription>
            Mỗi {RECHECK_INTERVAL_HOURS} giờ một lần, do máy chủ tự chạy — không còn mốc nào phải nhớ. Nhịp kiểm tra mỗi{" "}
            {HEARTBEAT_HOURS} giờ, và chỉ đo khi đã tới hạn.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {schedule.nothingToTrack ? (
            <p className="text-muted-foreground">
              Chưa có URL nào đang theo dõi, nên pipeline đúng khi không làm gì. Ghi mốc bên dưới là nó bắt đầu đo.
            </p>
          ) : schedule.lastRun === null ? (
            <p className="text-muted-foreground">
              Chưa có lần đo nào qua pipeline. Lần chạy tự động đầu tiên sẽ đo ngay vì chưa có mốc nào để so.
            </p>
          ) : (
            <>
              <p>
                <span className="text-muted-foreground">Đo lần cuối: </span>
                {schedule.lastRun.startedAt.toLocaleString("vi-VN")} — {schedule.lastRun.checked} URL
                {schedule.lastRun.failed > 0 && `, ${schedule.lastRun.failed} URL hỏi không được`}
                {schedule.lastRun.trigger === "manual" && " (bấm tay)"}
              </p>
              {schedule.lastRun.error && (
                <p className="text-destructive">Lần chạy gần nhất gãy: {schedule.lastRun.error}</p>
              )}
              {schedule.dueAt && (
                <p className="text-muted-foreground">
                  Tới hạn tiếp: {schedule.dueAt.toLocaleString("vi-VN")}
                  {schedule.overdue && " — đã quá hạn, nhịp gần nhất sẽ đo"}
                </p>
              )}
            </>
          )}
          {schedule.heartbeatStale && (
            <p className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Không có nhịp nào trong hơn {2 * HEARTBEAT_HOURS} giờ (lần cuối{" "}
                {schedule.lastHeartbeat?.toLocaleString("vi-VN")}). Timer trên máy chủ có thể đã dừng — kiểm{" "}
                <code>systemctl status pseo-index-recheck.timer</code>. Chuỗi đo đang có lỗ, và lỗ đó không đo bù được.
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ghi mốc bấm tay</CardTitle>
          <CardDescription>
            Sau khi bấm &quot;Yêu cầu lập chỉ mục&quot; trong Search Console. URL đã nằm trong phép thử Omega sẽ bị từ chối —
            bấm tay vào đó làm hỏng cả hai phép đo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RecordManualForm websiteId={websiteId} />
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Từng URL</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL</TableHead>
                    <TableHead>Nhánh</TableHead>
                    <TableHead>Lúc vào theo dõi</TableHead>
                    <TableHead>Trạng thái mới nhất</TableHead>
                    <TableHead className="text-right">Số lần đo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{r.path}</a>
                      </TableCell>
                      <TableCell className="text-xs">{ARM_LABEL[r.arm] ?? r.arm}</TableCell>
                      <TableCell className="text-xs">
                        {r.submittedAt.toISOString().slice(0, 10)}
                        <span className="ml-1 text-muted-foreground">
                          {r.indexedAtSubmit === null ? "(không đo được)" : r.indexedAtSubmit ? "· đã index sẵn" : "· chưa index"}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.latest ? (
                          <>
                            <span className={r.latest.verdict === "PASS" ? "font-medium text-green-700 dark:text-green-400" : r.latest.verdict === "ERROR" ? "text-red-700" : ""}>
                              {stateLabel(r.latest.coverageState)}
                            </span>
                            <span className="ml-1 text-muted-foreground">{r.latest.checkedAt.toISOString().slice(0, 10)}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">chưa đo</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{r.checkCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
