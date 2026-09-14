"use client";

import { useActionState } from "react";
import { updateAiBudgetAction, type ActionResult } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle, Wallet } from "lucide-react";
import { formatBudgetPercent, type BudgetStatus } from "@/lib/ai/budget-core";

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
        {/* Hai dòng, tên gọi theo THỨ NGƯỜI TA NHÌN THẤY trên site, không
            theo cách sổ sách phân loại. Nhãn cũ là "gắn đích danh site này"
            và "cache dùng chung của niche" — đúng về kế toán và vô nghĩa với
            người đọc, vì không nhãn nào trỏ tới một trang có thật. */}
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              Đoạn cho <span className="text-foreground">trang cụm</span> — chỉ site này dùng được
            </dt>
            {/* Không in "$0,0000" khi chưa có dòng nào: con số đó đọc ra là
                "site này chưa tiêu gì", khác hẳn "sổ chi chưa từng ghi
                site". Ô tiền không nói được sự khác biệt đó. */}
            <dd className="tabular-nums">
              {status.ownRows === 0 ? <span className="text-muted-foreground">chưa có khoản nào</span> : usd(status.ownUsd)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              Đoạn cho <span className="text-foreground">từng ZIP</span> — mọi site cùng ngành dùng lại
              {status.sharedWithSites > 1 && (
                <span className="ml-1 text-amber-700 dark:text-amber-500">· {status.sharedWithSites} site đang dùng</span>
              )}
            </dt>
            <dd className="tabular-nums">{usd(status.sharedUsd)}</dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">
          {status.ownRows === 0 ? (
            <>
              Chưa có đoạn trang cụm nào tính cho site này — 31 đoạn hiện có đã sinh xong trước khi sổ chi bắt đầu ghi
              site. Hàng trên sẽ có số từ lần sinh đoạn cụm kế tiếp.{" "}
            </>
          ) : null}
          Đoạn cho từng ZIP viết một lần rồi cache theo ngành, nên một site thứ hai cùng ngành không phải trả lại khoản
          đó — nó chỉ tốn thêm phần đoạn trang cụm của riêng nó. Tách hai dòng là để thấy được điều đó; gộp một số thì
          không.
        </p>

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
