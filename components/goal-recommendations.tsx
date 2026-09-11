"use client";

import { useActionState } from "react";
import { AlertTriangle, Check, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { setGoalAction, type GoalActionResult } from "@/app/publisher/[websiteId]/goal/actions";
import { GOALS, type Goal, type Recommendation } from "@/lib/publisher/recommend";

const EMPTY: GoalActionResult = { ok: false, message: "" };

/**
 * Ba trạng thái hiện thành ba khối riêng, không trộn.
 *
 * "Không đo được" nằm TRÊN "đã ổn" chứ không nằm dưới: nó là việc phải làm,
 * còn phần ổn chỉ là thứ để yên tâm. Xếp ngược lại thì một site mất kết nối
 * GSC sẽ trông như một site chỉ có toàn dấu tích.
 */
export function GoalRecommendations({
  websiteId,
  goal,
  recommendations,
}: {
  websiteId: string;
  goal: Goal | null;
  recommendations: Recommendation[];
}) {
  const [state, action, pending] = useActionState(setGoalAction, EMPTY);

  const fired = recommendations.filter((r) => r.verdict.status === "fired");
  const unmeasurable = recommendations.filter((r) => r.verdict.status === "unmeasurable");
  const okRows = recommendations.filter((r) => r.verdict.status === "ok");

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-2">
        <span className="text-xs font-medium">Site này đang đuổi mục tiêu gì</span>
        <input type="hidden" name="websiteId" value={websiteId} />
        <div className="flex flex-wrap gap-2">
          {GOALS.map((g) => (
            <button
              key={g.id}
              type="submit"
              name="goal"
              value={g.id}
              disabled={pending}
              title={g.hint}
              className={`rounded-md border px-3 py-1.5 text-left text-sm ${
                goal === g.id ? "border-foreground bg-muted" : "hover:bg-muted/50"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        {goal && <p className="text-xs text-muted-foreground">{GOALS.find((g) => g.id === goal)?.hint}</p>}
        {state.message && (
          <p className={`text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.message}</p>
        )}
      </form>

      {goal === null ? (
        /* Không đoán mục tiêu. Đoán ra "traffic" rồi khuyên tự tin cho thứ chủ
           site chưa từng đặt là cách tệ nhất để sai: lời khuyên nghe đúng, chỉ
           là đúng cho một mục tiêu khác. */
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Chưa chọn mục tiêu, nên chưa có đề xuất nào. Cùng những con số này, một site đang đuổi index và một site đang
          đuổi lead cần nghe hai việc khác nhau — nên ở đây không đoán hộ.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {fired.length === 0 && unmeasurable.length === 0 && (
            <p className="text-sm text-emerald-700">Không luật nào cho mục tiêu này đang báo vấn đề.</p>
          )}

          {fired.map((r) => {
            const v = r.verdict as Extract<Recommendation["verdict"], { status: "fired" }>;
            return (
              <div key={r.id} className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                  <span className="text-sm font-medium">{r.title}</span>
                  <Badge variant={v.severity === "cao" ? "destructive" : "secondary"}>{v.severity}</Badge>
                </div>
                <p className="text-xs">{v.evidence}</p>
                <p className="text-xs font-medium">{v.action}</p>
              </div>
            );
          })}

          {unmeasurable.map((r) => {
            const v = r.verdict as Extract<Recommendation["verdict"], { status: "unmeasurable" }>;
            return (
              <div key={r.id} className="flex flex-col gap-1 rounded-lg border border-dashed p-3">
                <div className="flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium">{r.title}</span>
                  <Badge variant="outline">không đo được</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{v.missing}</p>
                <p className="text-xs">{v.fix}</p>
              </div>
            );
          })}

          {okRows.length > 0 && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-xs font-medium">
                {okRows.length} mục đã ổn — bấm để xem con số
              </summary>
              <ul className="flex flex-col gap-1 pt-2">
                {okRows.map((r) => (
                  <li key={r.id} className="flex items-start gap-1.5 text-xs">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                    <span>
                      <span className="font-medium">{r.title}</span> — {(r.verdict as { evidence: string }).evidence}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
