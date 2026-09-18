"use client";

import { useActionState, useState } from "react";
import { fillClusterBatchAction, type FillBatchResult } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";
import type { ClusterCandidate, ClusterFillSummary } from "@/lib/queries/cluster-fill-queue";
import { COST_PER_CLUSTER_USD } from "@/lib/queries/cluster-fill-queue";

const initial: FillBatchResult = { ok: false, message: "" };

/** Lô nhỏ hơn lô theo ZIP (5): một cụm tốn gấp ~2,6 lần và trung bình 1,8
 *  lần thử, nên một lô 5 cụm chạy lâu gấp mấy lần lô 5 ZIP. Lô là điểm dừng,
 *  và một điểm dừng cách nhau mười phút thì không còn là điểm dừng. */
const BATCH = 3;

export function ClusterFillQueue({
  websiteId,
  summary,
  pending,
  unavailable,
}: {
  websiteId: string;
  summary: ClusterFillSummary;
  pending: ClusterCandidate[];
  unavailable?: string;
}) {
  const [state, action, running] = useActionState(fillClusterBatchAction, initial);
  const [confirmedAll, setConfirmedAll] = useState(false);

  if (unavailable) return <p className="text-sm text-destructive">{unavailable}</p>;

  const pct = summary.total === 0 ? 0 : Math.round((summary.served / summary.total) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-sm">
          <span>
            <strong>{summary.served}</strong> / {summary.total} trang cụm đã có chữ
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-green-600" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="rounded-md border p-3 text-xs">
        <div className="flex justify-between">
          <span>Điền {summary.total - summary.served} cụm còn lại</span>
          <span className="font-medium">≈ ${summary.estimatedUsd.toFixed(2)}</span>
        </div>
        <p className="mt-2 text-muted-foreground">
          ${COST_PER_CLUSTER_USD.toFixed(4)}/cụm — p90 đo trên 55 cụm đã trả tiền thật, gấp ~2,6 lần một đoạn theo ZIP. Cụm
          cần trung bình 1,8 lần thử vì luật &ldquo;đừng nói một đầu dải như thể nó tả cả vùng&rdquo; khó hơn hẳn, và mỗi lần
          thử là một lần trả tiền.
        </p>
      </div>

      {pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <form action={action}>
            <input type="hidden" name="websiteId" value={websiteId} />
            <input type="hidden" name="size" value={BATCH} />
            <Button type="submit" size="sm" variant="secondary" disabled={running}>
              {running ? "Đang điền…" : `Điền ${Math.min(BATCH, pending.length)} cụm quan trọng nhất`}
            </Button>
          </form>

          {!confirmedAll ? (
            <Button type="button" size="sm" variant="outline" disabled={running} onClick={() => setConfirmedAll(true)}>
              Điền lô lớn…
            </Button>
          ) : (
            <form action={action} className="flex items-center gap-2">
              <input type="hidden" name="websiteId" value={websiteId} />
              <input type="hidden" name="size" value={15} />
              <span className="text-xs text-destructive">
                Sẽ tiêu tới ${(Math.min(15, pending.length) * COST_PER_CLUSTER_USD).toFixed(2)} cho lô này. Chắc chưa?
              </span>
              <Button type="submit" size="sm" variant="destructive" disabled={running}>
                Điền lô 15
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
        <p className="text-sm text-muted-foreground">Mọi trang cụm đều đã có chữ.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">#</th>
                <th className="py-1 pr-3">Trang cụm</th>
                <th className="py-1 pr-3">ZIP gộp</th>
                <th className="py-1 pr-3">Từ khoá chính</th>
                <th className="py-1">Lượt/tháng</th>
              </tr>
            </thead>
            <tbody>
              {pending.slice(0, 20).map((c, i) => (
                <tr key={c.path} className="border-t">
                  <td className="py-1 pr-3 text-muted-foreground">{i + 1}</td>
                  <td className="py-1 pr-3 font-mono">{c.path}</td>
                  <td className="py-1 pr-3">{c.zips.length}</td>
                  <td className="py-1 pr-3">{c.keyword ?? "—"}</td>
                  <td className="py-1">
                    {c.searchVolume === null ? (
                      <span className="text-muted-foreground">chưa đo</span>
                    ) : (
                      c.searchVolume.toLocaleString("vi-VN")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pending.length > 20 && <p className="pt-2 text-xs text-muted-foreground">… và {pending.length - 20} cụm nữa.</p>}
        </div>
      )}
    </div>
  );
}
