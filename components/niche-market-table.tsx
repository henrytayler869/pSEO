"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import type { TrafficRankedRow, KeywordRow } from "@/lib/queries/traffic-research";

const INTENT_LABEL: Record<string, string> = {
  commercial: "so sánh",
  informational: "tìm hiểu",
  transactional: "sẵn sàng thuê",
  navigational: "tìm thương hiệu",
};

/**
 * Bảng thị trường, mở ra được để xem từng từ khoá.
 *
 * Trước đây bảng chỉ hiện số TỔNG HỢP của mỗi thị trường — lượng tìm kiếm
 * cộng lại, KD trung bình, CPC trung bình — nên "nghiên cứu niche" không xem
 * được thứ đang được nghiên cứu. Một thị trường có ba từ khoá và một thị
 * trường có một từ khoá nhìn giống hệt nhau ở mức tổng.
 */
function KeywordLine({ k }: { k: KeywordRow }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
      <span className="min-w-56 font-mono">{k.keyword}</span>
      <span className="tabular-nums">{formatNumber(k.searchVolume)} lượt</span>
      <span className="tabular-nums text-muted-foreground">KD {k.keywordDifficulty.toFixed(0)}</span>
      <span className="tabular-nums text-muted-foreground">${k.cpc.toFixed(2)}</span>
      {/* Ý định hiện NHÃN GỐC khi chưa dịch được, và hiện "chưa đo" khi null
          — null nghĩa là lần đo đó không lấy trường này, không phải "không
          có ý định". */}
      <span className="text-muted-foreground">
        {k.mainIntent === null ? "ý định: chưa đo" : (INTENT_LABEL[k.mainIntent] ?? k.mainIntent)}
      </span>
      <span className="text-muted-foreground">đo {k.fetchedAt.toISOString().slice(0, 10)}</span>
    </div>
  );
}

export function NicheMarketTable({ rows }: { rows: TrafficRankedRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Thị trường</TableHead>
          <TableHead className="text-right">Lượng tìm kiếm</TableHead>
          <TableHead className="text-right">Độ khó (KD)</TableHead>
          <TableHead className="text-right">CPC</TableHead>
          <TableHead className="text-right">Điểm traffic</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const isOpen = open.has(r.marketIdentityId);
          const n = r.keywords.length;
          const nCounty = r.countyKeywords.length;
          const expandable = n + nCounty > 0;
          return [
            <TableRow
              key={r.marketIdentityId}
              className={expandable ? "cursor-pointer" : undefined}
              onClick={expandable ? () => toggle(r.marketIdentityId) : undefined}
            >
              <TableCell>
                <div className="flex items-center gap-1.5">
                  {expandable ? (
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  ) : (
                    <span className="w-3.5" />
                  )}
                  <span>
                    {r.city ? `${r.city}, ${r.state}` : r.state} <span className="text-muted-foreground">{r.zip}</span>
                  </span>
                  {/* Số từ khoá nằm ngay trên hàng, không giấu sau cú bấm:
                      "0 từ khoá" và "3 từ khoá" là hai tình trạng khác hẳn
                      nhau, và người ta cần biết TRƯỚC khi quyết định bấm. */}
                  <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {n === 0 && nCounty === 0
                      ? "chưa có từ khoá"
                      : `${n} từ khoá${nCounty > 0 ? ` + ${nCounty} cấp hạt` : ""}`}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.searchVolume !== null ? formatNumber(r.searchVolume) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{r.keywordDifficulty !== null ? r.keywordDifficulty.toFixed(0) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{r.cpc !== null ? `$${r.cpc.toFixed(2)}` : "—"}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{r.score !== null ? r.score.toFixed(1) : "—"}</TableCell>
            </TableRow>,
            isOpen && expandable ? (
              <TableRow key={`${r.marketIdentityId}-kw`} className="bg-muted/30 hover:bg-muted/30">
                <TableCell colSpan={5} className="py-2">
                  <div className="ml-5 flex flex-col gap-3">
                    {n > 0 && (
                      <div className="flex flex-col gap-1">
                        <div className="text-xs font-medium">Từ khoá của ZIP này</div>
                        {r.keywords.map((k) => (
                          <KeywordLine key={k.keyword} k={k} />
                        ))}
                        {n > 1 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Cột Lượng tìm kiếm ở hàng trên là TỔNG {n} từ khoá này; KD và CPC là trung bình.
                          </p>
                        )}
                      </div>
                    )}

                    {nCounty > 0 && (
                      <div className="flex flex-col gap-1 border-t pt-2">
                        <div className="text-xs font-medium">Từ khoá cấp hạt phủ ZIP này</div>
                        {r.countyKeywords.map((k) => (
                          <KeywordLine key={k.keyword} k={k} />
                        ))}
                        {/* Vì sao KHÔNG cộng vào cột trên — nói ngay tại chỗ,
                            không để trong tài liệu. Một từ khoá cấp hạt phủ
                            hàng chục ZIP; cộng nó vào từng ZIP là đếm cùng
                            một nhu cầu nhiều lần và làm mọi xếp hạng sai. */}
                        <p className="mt-1 text-xs text-muted-foreground">
                          KHÔNG cộng vào các cột ở hàng trên: từ khoá này phủ mọi ZIP trong hạt, cộng vào từng ZIP là
                          đếm cùng một nhu cầu nhiều lần. Nó cũng không thay thế từ khoá của ZIP — xem guide §3.6.
                        </p>
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : null,
          ];
        })}
      </TableBody>
    </Table>
  );
}
