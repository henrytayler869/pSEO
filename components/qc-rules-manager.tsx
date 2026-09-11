"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  toggleQcRuleAction,
  saveQcThresholdsAction,
  addCustomQcRuleAction,
  deleteCustomQcRuleAction,
  type QcRuleActionResult,
  type QcRuleRow,
} from "@/app/settings/qc-rules-actions";

const EMPTY: QcRuleActionResult = { ok: false, message: "" };

function Msg({ state }: { state: QcRuleActionResult }) {
  if (!state.message) return null;
  return <p className={`text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.message}</p>;
}

function RuleCard({ rule }: { rule: QcRuleRow }) {
  const [toggleState, toggleAction, toggling] = useActionState(toggleQcRuleAction, EMPTY);
  const [saveState, saveAction, saving] = useActionState(saveQcThresholdsAction, EMPTY);
  const [delState, delAction, deleting] = useActionState(deleteCustomQcRuleAction, EMPTY);

  // Sắp min trước max. jsonb của Postgres sắp lại khoá khi lưu, nên thứ tự
  // đọc ra là "max, min" — hai ô số cạnh nhau đảo ngược nghĩa là người sửa
  // ngưỡng rất dễ gõ nhầm ô.
  const ORDER = ["min", "max"];
  const numeric = (Object.entries(rule.params).filter(([, v]) => typeof v === "number") as [string, number][]).sort(
    ([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b)
  );
  const custom = !rule.builtin;

  return (
    <div className={`flex flex-col gap-2 rounded-lg border p-3 ${rule.isActive ? "" : "bg-muted/40 opacity-70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{rule.label}</span>
            <Badge variant={rule.kind === "content" ? "default" : "outline"}>
              {rule.kind === "content" ? "Nội dung" : "Technical"}
            </Badge>
            {!rule.isActive && <Badge variant="destructive">đang tắt</Badge>}
            {custom && <Badge variant="secondary">tự thêm</Badge>}
          </div>
          <p className="pt-0.5 text-xs text-muted-foreground">{rule.why}</p>
          {custom && (
            <p className="pt-0.5 font-mono text-xs text-muted-foreground">
              {String(rule.params.mode)} · /{String(rule.params.pattern)}/
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <form action={toggleAction}>
            <input type="hidden" name="id" value={rule.id} />
            <Button type="submit" size="sm" variant={rule.isActive ? "ghost" : "secondary"} disabled={toggling}>
              {rule.isActive ? "Tắt" : "Bật"}
            </Button>
          </form>
          {custom && (
            <form action={delAction}>
              <input type="hidden" name="id" value={rule.id} />
              <Button type="submit" size="sm" variant="ghost" disabled={deleting}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </form>
          )}
        </div>
      </div>

      {numeric.length > 0 && (
        <form action={saveAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={rule.id} />
          {numeric.map(([key, value]) => (
            <label key={key} className="text-xs">
              <span className="block text-muted-foreground">{key}</span>
              <input
                name={key}
                type="number"
                min={0}
                defaultValue={value}
                className="mt-0.5 w-20 rounded-md border px-2 py-1 text-sm"
              />
            </label>
          ))}
          <Button type="submit" size="sm" variant="secondary" disabled={saving}>
            Lưu ngưỡng
          </Button>
        </form>
      )}

      <Msg state={toggleState} />
      <Msg state={saveState} />
      <Msg state={delState} />
    </div>
  );
}

export function QcRulesManager({ rules }: { rules: QcRuleRow[] }) {
  const [addState, addAction, adding] = useActionState(addCustomQcRuleAction, EMPTY);
  const [open, setOpen] = useState(false);

  const off = rules.filter((r) => !r.isActive).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {rules.length} luật, {off} đang tắt. Một luật tắt sẽ <strong>biến mất khỏi báo cáo</strong> của bài viết mới —
        không phải hiện dấu tích xanh. Dấu tích nghĩa là đã kiểm và đạt; không ai kiểm thì không có dấu nào.
      </p>

      <div className="flex flex-col gap-2">
        {rules.map((r) => (
          <RuleCard key={r.id} rule={r} />
        ))}
      </div>

      {!open ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)} className="self-start">
          <Plus className="h-3.5 w-3.5" /> Thêm luật
        </Button>
      ) : (
        <form action={addAction} className="flex flex-col gap-2 rounded-lg border p-3">
          {/* Chỉ có luật dạng MẪU. Chín luật dựng sẵn là code — sửa được ngưỡng
              và bật/tắt, nhưng không đổi được thứ chúng soi. Một ô "nhập luật
              bất kỳ" sẽ là lời hứa chỉ vỡ vào ngày ai đó tin vào một luật chưa
              từng chạy. */}
          <p className="text-xs text-muted-foreground">
            Luật tự thêm là một <strong>mẫu regex</strong> chạy trên văn bản nhìn thấy được của bài. Chín luật dựng sẵn
            ở trên là code: sửa được ngưỡng và bật/tắt, không đổi được thứ chúng soi.
          </p>
          <div className="flex flex-wrap gap-2">
            <label className="text-xs">
              <span className="block text-muted-foreground">Tên hiển thị</span>
              <input name="label" required className="mt-0.5 w-56 rounded-md border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs">
              <span className="block text-muted-foreground">Chế độ</span>
              <select name="mode" defaultValue="must-not-match" className="mt-0.5 rounded-md border px-2 py-1 text-sm">
                <option value="must-not-match">Không được chứa</option>
                <option value="must-contain">Bắt buộc chứa</option>
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-muted-foreground">Nhóm</span>
              <select name="kind" defaultValue="content" className="mt-0.5 rounded-md border px-2 py-1 text-sm">
                <option value="content">Nội dung</option>
                <option value="technical">Technical</option>
              </select>
            </label>
          </div>
          <label className="text-xs">
            <span className="block text-muted-foreground">Mẫu regex (không phân biệt hoa thường)</span>
            <input
              name="pattern"
              required
              placeholder="cheapest|guaranteed lowest"
              className="mt-0.5 w-full rounded-md border px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">Vì sao cần luật này</span>
            <input name="why" className="mt-0.5 w-full rounded-md border px-2 py-1 text-sm" />
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={adding}>
              Thêm
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
          </div>
          <Msg state={addState} />
        </form>
      )}
    </div>
  );
}
