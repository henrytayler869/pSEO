"use client";

import { useActionState } from "react";
import { updateAiBudgetAction, type ActionResult } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle, Wallet } from "lucide-react";
import { formatBudgetPercent, type BudgetStatus } from "@/lib/ai/budget";

const initialState: ActionResult = { ok: false, message: "" };
const usd = (n: number) => `$${n.toFixed(4)}`;

/**
 * Ngân sách AI của publisher.
 *
 * Ba trạng thái hiện ra ba kiểu, không phải hai. "Chưa đặt" không được nhìn
 * giống "đang trong ngân sách": một thẻ trung tính cho một ngân sách không
 * tồn tại trả lời sai đúng câu người ta đang hỏi.
 */
export function AiBudgetCard({ websiteId, status }: { websiteId: string; status: BudgetStatus }) {
  const [state, formAction, pending] = useActionState(updateAiBudgetAction, initialState);
  const over = status.verdict === "over";

  return (
    <Card className={over ? "border-red-500/60 bg-red-50/60 dark:bg-red-950/20" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {over ? <AlertTriangle className="h-4 w-4 text-red-600" /> : <Wallet className="h-4 w-4 text-muted-foreground" />}
          Ngân sách AI
        </CardTitle>
        <CardDescription>
          Mềm — không chặn việc sinh nội dung. Nội dung của publisher phụ thuộc hoàn toàn vào AI,
          nên đây là để biết mình đang ở đâu, không phải để dừng giữa chừng.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <div className="text-xs text-muted-foreground">Đã tiêu</div>
            <div className={`text-2xl font-semibold tabular-nums ${over ? "text-red-700 dark:text-red-400" : ""}`}>
              {usd(status.totalUsd)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Ngân sách</div>
            <div className="text-2xl font-semibold tabular-nums">
              {status.budgetUsd === null ? <span className="text-muted-foreground">chưa đặt</span> : `$${status.budgetUsd.toFixed(2)}`}
            </div>
          </div>
          {status.percent !== null && (
            <div>
              <div className="text-xs text-muted-foreground">Tỷ lệ</div>
              <div className={`text-2xl font-semibold tabular-nums ${over ? "text-red-700 dark:text-red-400" : ""}`}>
                {formatBudgetPercent(status.percent)}
              </div>
            </div>
          )}
        </div>

        {over && (
          <p className="rounded-md border border-red-500/50 bg-red-100/60 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
            Vượt {usd(status.overUsd)} so với ngân sách. Việc sinh nội dung vẫn chạy — chặn cứng chống chạy loạn
            nằm ở Cài đặt và là con số khác.
          </p>
        )}

        {status.verdict === "no-budget" && (
          <p className="rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            Chưa đặt ngân sách, nên không có gì để so. Đặt một con số thì thẻ này mới highlight được khi vượt.
          </p>
        )}

        {/* Tách riêng phần dùng chung: nó là chi tiêu của NICHE, không của
            site. Gộp vào một số duy nhất sẽ làm người đọc tưởng site mình
            tiêu ngần ấy, trong khi hai publisher cùng niche nhìn thấy đúng
            cùng một con số. */}
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Gắn đích danh site này</dt>
            <dd className="tabular-nums">{usd(status.ownUsd)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              Cache dùng chung của niche
              {status.sharedWithSites > 1 && (
                <span className="ml-1 text-amber-700 dark:text-amber-500">· {status.sharedWithSites} publisher cùng dùng</span>
              )}
            </dt>
            <dd className="tabular-nums">{usd(status.sharedUsd)}</dd>
          </div>
        </dl>

        {status.sharedWithSites > 1 && (
          <p className="text-xs text-muted-foreground">
            Đoạn diễn giải của một ZIP được cache theo niche và phục vụ mọi publisher trong niche đó,
            nên khoản dùng chung không chia riêng cho site nào. {status.sharedWithSites} publisher cùng niche
            sẽ thấy đúng con số này.
          </p>
        )}

        <form action={formAction} className="flex flex-wrap items-end gap-3 border-t pt-4">
          <input type="hidden" name="websiteId" value={websiteId} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Ngân sách (USD)</span>
            <input
              name="aiBudgetUsd"
              defaultValue={status.budgetUsd === null ? "" : String(status.budgetUsd)}
              placeholder="để trống = không theo dõi"
              inputMode="decimal"
              autoComplete="off"
              className="w-56 rounded-md border px-2.5 py-1.5 font-mono text-sm"
            />
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? "Đang lưu..." : "Lưu"}
          </Button>
          {state.message && (
            <p className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
