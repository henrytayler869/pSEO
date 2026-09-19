"use client";

import { useActionState, useState } from "react";
import { fillContentBatchAction, type FillBatchResult } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { RankedCandidate, FillSummary } from "@/lib/ai/fill-queue";

const initial: FillBatchResult = { ok: false, message: "" };

/** Lô mặc định. Nhỏ có chủ ý: mỗi lô là một lần kiểm ngân sách mới và một
 *  điểm dừng được. Một lô lớn chạy mười phút không dừng được là thứ người ta
 *  sẽ đóng tab giữa chừng rồi không biết nó đã tiêu bao nhiêu. */
const BATCH = 5;

export function ContentFillQueue({
  websiteId,
  vertical,
  summary,
  pending,
  budgetUsd,
  spentUsd,
  excluded,
  needsReview,
  unavailable,
}: {
  websiteId: string;
  vertical: string;
  summary: FillSummary;
  pending: RankedCandidate[];
  budgetUsd: number | null;
  spentUsd: number;
  excluded: { cluster: number; noPage: number; noData: number; repeatedlyRejected: number };
  needsReview: string[];
  unavailable?: string;
}) {
  const [state, action, running] = useActionState(fillContentBatchAction, initial);
  const [confirmedAll, setConfirmedAll] = useState(false);

  if (unavailable) {
    return (
      <p className="text-sm text-destructive">
        {unavailable}
      </p>
    );
  }

  const pct = summary.total === 0 ? 0 : Math.round((summary.served / summary.total) * 100);
  const skipped = excluded.cluster + excluded.noPage + excluded.noData + excluded.repeatedlyRejected;
  const after = spentUsd + summary.estimatedUsd;
  const overBudget = budgetUsd !== null && after > budgetUsd;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-sm">
          <span>
            <strong>{summary.served}</strong> / {summary.total} trang đã có chữ
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-green-600" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex flex-wrap gap-2 pt-1 text-xs">
          {summary.stale > 0 && (
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
              {summary.stale} đã trả tiền nhưng chữ không tới nơi
            </Badge>
          )}
          {summary.never > 0 && <Badge variant="secondary">{summary.never} chưa làm</Badge>}
        </div>
        {/* Vì sao tổng nhỏ hơn số ZIP đã nghiên cứu. Không nói ra thì con số
            trông như dữ liệu bị mất, và người đọc sẽ đi tìm thứ không hỏng. */}
        {skipped > 0 && (
          <p className="pt-1 text-xs text-muted-foreground">
            Bỏ qua {skipped} ZIP vì đoạn sinh ra sẽ không hiện ở đâu:{" "}
            {excluded.cluster > 0 && <>{excluded.cluster} nằm trong trang cụm (trang cụm dùng đoạn cấp cụm)</>}
            {excluded.cluster > 0 && (excluded.noPage > 0 || excluded.noData > 0) ? ", " : ""}
            {excluded.noPage > 0 && <>{excluded.noPage} chưa có trang nào phục vụ</>}
            {excluded.noPage > 0 && excluded.noData > 0 ? ", " : ""}
            {excluded.noData > 0 && <>{excluded.noData} chưa thu được dữ liệu</>}
            {excluded.repeatedlyRejected > 0 && (
              <>
                {excluded.cluster + excluded.noPage + excluded.noData > 0 ? ", " : ""}
                {excluded.repeatedlyRejected} đã trả tiền ≥3 lần mà chưa lần nào đạt
              </>
            )}
            .
          </p>
        )}
        {/* Nêu tên, không chỉ đếm: đây là việc cần người xem, và một con số
            không kèm ZIP thì không ai xem được gì. */}
        {needsReview.length > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-500">
            Cần xem lại (đã trả tiền ≥3 lần, chưa đạt): <span className="font-mono">{needsReview.join(", ")}</span>
          </p>
        )}
      </div>

      {/* Chi phí nói TRƯỚC khi tiêu, không phải sau. */}
      <div className="rounded-md border p-3 text-xs">
        <div className="flex justify-between">
          <span>Điền hết {summary.total - summary.served} trang còn lại</span>
          <span className="font-medium">≈ ${summary.estimatedUsd.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Đã tiêu toàn hệ</span>
          <span>${spentUsd.toFixed(2)}</span>
        </div>
        <div className={`flex justify-between ${overBudget ? "font-medium text-destructive" : "text-muted-foreground"}`}>
          <span>Sau khi điền hết</span>
          <span>
            ${after.toFixed(2)}
            {budgetUsd !== null && ` / $${budgetUsd.toFixed(2)}`}
          </span>
        </div>
        <p className="mt-2 text-muted-foreground">
          Ước theo p90 của {summary.total} đoạn đã trả tiền thật, không phải trung bình — ước thấp là cách người bấm biết mình
          vượt ngân sách sau khi đã tiêu.
        </p>
      </div>

      {pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <form action={action}>
            <input type="hidden" name="websiteId" value={websiteId} />
            <input type="hidden" name="size" value={BATCH} />
            <Button type="submit" size="sm" variant="secondary" disabled={running}>
              {running ? "Đang điền…" : `Điền ${Math.min(BATCH, pending.length)} trang quan trọng nhất`}
            </Button>
          </form>

          {!confirmedAll ? (
            <Button type="button" size="sm" variant="outline" disabled={running} onClick={() => setConfirmedAll(true)}>
              Điền tất cả…
            </Button>
          ) : (
            <form action={action} className="flex items-center gap-2">
              <input type="hidden" name="websiteId" value={websiteId} />
              <input type="hidden" name="size" value={25} />
              <span className="text-xs text-destructive">
                Sẽ tiêu tới ${(Math.min(25, pending.length) * 0.0237).toFixed(2)} cho lô này. Chắc chưa?
              </span>
              <Button type="submit" size="sm" variant="destructive" disabled={running}>
                Điền lô 25
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmedAll(false)}>
                Thôi
              </Button>
            </form>
          )}
        </div>
      )}

      {state.message && (
        <p className={`text-xs ${state.ok ? "text-muted-foreground" : "text-destructive"}`}>
          {state.message}
          {state.rejected !== undefined && state.rejected > 0 && (
            <> — bị chặn là validator làm đúng việc, không phải lỗi.</>
          )}
        </p>
      )}

      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">Mọi trang của niche {vertical} đều đã có chữ.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">#</th>
                <th className="py-1 pr-3">ZIP</th>
                <th className="py-1 pr-3">Thị trường</th>
                <th className="py-1 pr-3">Từ khoá chính</th>
                <th className="py-1">Vì sao xếp trước</th>
              </tr>
            </thead>
            <tbody>
              {pending.slice(0, 20).map((p) => (
                <tr key={p.zip} className="border-t">
                  <td className="py-1 pr-3 text-muted-foreground">{p.rank}</td>
                  <td className="py-1 pr-3 font-mono">{p.zip}</td>
                  <td className="py-1 pr-3">
                    {p.city ?? "—"}, {p.state}
                  </td>
                  <td className="py-1 pr-3">{p.mainKeyword ?? "—"}</td>
                  <td className="py-1 text-muted-foreground">{p.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pending.length > 20 && (
            <p className="pt-2 text-xs text-muted-foreground">… và {pending.length - 20} trang nữa.</p>
          )}
        </div>
      )}
    </div>
  );
}
