import Link from "next/link";
import { AlertTriangle, Archive, CircleSlash, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import type { LeagueCard, UclSeasonCard } from "@/lib/football/cached";

/**
 * Thị trường Việt Nam: KHÔNG có cột điểm, và đó là thiết kế chứ không phải
 * thiếu sót.
 *
 * Phía Hoa Kỳ xếp hạng theo giá trị kỳ vọng, tính từ CPC và độ khó từ khoá
 * của từng mã ZIP. Phía Việt Nam chỉ có một niche — bóng đá nam — nên không
 * có gì để xếp hạng với nhau, và số CPC/độ khó cho Việt Nam phải mua từ
 * DataForSEO (location_code 2704) trong khi yêu cầu là nguồn miễn phí trước.
 *
 * Nên chỗ này hiện thứ ĐO ĐƯỢC MIỄN PHÍ và quyết định được việc: dữ liệu có
 * bao nhiêu, mới tới đâu, và có nguồn thứ hai kiểm chéo hay không. Một cột
 * "Điểm" bỏ trống ở đây sẽ là lời mời điền vào đó một con số không có nguồn —
 * nên nó không tồn tại.
 */

function stalenessBadge(days: number | null) {
  if (days === null) return <Badge variant="secondary">chưa đá trận nào</Badge>;
  if (days <= 2) return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">trễ {days} ngày</Badge>;
  if (days <= 7) return <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">trễ {days} ngày</Badge>;
  return <Badge variant="destructive">trễ {days} ngày</Badge>;
}

function viDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function LeagueTile({ l }: { l: LeagueCard }) {
  if (l.error) {
    return (
      <Card className="border-destructive/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            {l.label}
            <Badge variant="destructive">không tải được</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs break-words text-muted-foreground">
          {/* Hiện nguyên văn lý do. "Không tải được" mà không nói vì sao thì
              người đọc không phân biệt được mạng hỏng với nguồn đổi hình dạng. */}
          {l.error}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          {l.label}
          {stalenessBadge(l.stalenessDays)}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Mùa {l.season}</span>
          <span>
            {l.played}/{l.matches} trận đã đá
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Kết quả mới nhất</span>
          <span>{viDate(l.lastResultDate)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Dẫn đầu</span>
          <span className="truncate pl-2 text-right">{l.leader ?? "—"}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5 border-t pt-2">
          {l.overlaySource === "txt" ? (
            <Badge variant="secondary">
              hai nguồn · +{l.overlaid} trận từ bản .txt
            </Badge>
          ) : (
            /* Một nguồn không phải là lỗi, nhưng nó là thông tin: không có gì
               kiểm chéo, nên mọi con số ở ô này chỉ là lời khai một phía. */
            <Badge variant="outline">một nguồn · không kiểm chéo được</Badge>
          )}
          {l.conflicts > 0 && <Badge variant="destructive">{l.conflicts} xung đột tỷ số</Badge>}
          {l.unmatched > 0 && <Badge variant="destructive">{l.unmatched} trận không ghép được</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}

export function VietnamFootballMarket({
  leagues,
  archive,
  archiveSeasonCount,
  archiveHref,
}: {
  leagues: LeagueCard[];
  /** null = chưa mở bảng lưu trữ, nên chưa tải 15 mùa. */
  archive: UclSeasonCard[] | null;
  archiveSeasonCount: number;
  archiveHref: string;
}) {
  const broken = leagues.filter((l) => l.error).length;

  return (
    <div className="flex flex-col gap-8">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Thị trường này không chấm điểm niche</AlertTitle>
        <AlertDescription>
          Việt Nam chỉ nhắm một niche — bóng đá nam — nên không có gì để xếp hạng với nhau. CPC và độ khó từ
          khoá cho Việt Nam phải mua từ DataForSEO, trong khi hướng hiện tại là dùng nguồn miễn phí trước. Chỗ
          này vì thế hiện thứ đo được miễn phí và quyết định được việc: dữ liệu có bao nhiêu, mới tới đâu, và
          có nguồn thứ hai kiểm chéo hay không.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Giải đang diễn ra — kết quả và độ tươi của dữ liệu
        </h2>
        {broken > 0 && (
          <p className="text-sm text-destructive">
            {broken}/{leagues.length} giải không tải được ở lần dựng gần nhất. Xem lý do trong từng ô.
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {leagues.map((l) => (
            <LeagueTile key={l.code} l={l} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Champions League — chỉ lưu trữ
        </h2>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Archive className="h-4 w-4 text-muted-foreground" />
              {archiveSeasonCount} mùa đã kết thúc
              <Badge variant="outline">không có mùa đang đá</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Kho nguồn không có thư mục mùa hiện tại và lần đẩy cuối là 2/7/2026, trong khi các kho giải quốc
              nội được đẩy hằng ngày. Mùa 2025-26 còn tới muộn 49 ngày sau trận đầu tiên, rồi im lặng 99 ngày
              giữa mùa. Nên giải này dùng được cho nội dung lưu trữ, không dùng được cho lịch và kết quả.
            </p>
            {archive === null ? (
              <Link href={archiveHref} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                Xem {archiveSeasonCount} mùa và nhà vô địch từng mùa →
              </Link>
            ) : (
              <div className="overflow-x-auto rounded-md border bg-background">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mùa</TableHead>
                      <TableHead>Vô địch</TableHead>
                      <TableHead>Á quân</TableHead>
                      <TableHead>Chung kết</TableHead>
                      <TableHead className="text-right">Trận</TableHead>
                      <TableHead className="text-right">Bàn</TableHead>
                      <TableHead>Nguồn</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {archive.map((s) => (
                      <TableRow key={s.season}>
                        <TableCell className="font-medium">{s.season}</TableCell>
                        {s.error ? (
                          <TableCell colSpan={6} className="text-xs text-destructive">
                            {s.error}
                          </TableCell>
                        ) : (
                          <>
                            <TableCell>
                              <span className="inline-flex items-center gap-1.5">
                                <Trophy className="h-3.5 w-3.5 text-amber-500" />
                                {s.champion ?? "—"}
                              </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{s.runnerUp ?? "—"}</TableCell>
                            <TableCell>{s.finalScore ?? "—"}</TableCell>
                            <TableCell className="text-right">{formatNumber(s.matches)}</TableCell>
                            <TableCell className="text-right">{formatNumber(s.goals)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs">
                                {s.source === "txt" ? ".txt" : ".json"}
                              </Badge>
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Chưa có nguồn</h2>
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleSlash className="h-4 w-4 text-muted-foreground" />
              V.League 1
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            openfootball không có giải Việt Nam. Nguồn miễn phí duy nhất tìm được là TheSportsDB, và nó trả về
            Wigan Athletic, Blackpool, Leicester làm đội V.League 1 — dữ liệu SAI chứ không phải thiếu, nên
            không dùng được kể cả để lấp tạm. Giải trong nước vì thế đang là lỗ hổng lớn nhất của thị trường
            này, không phải một mục chưa làm tới.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
