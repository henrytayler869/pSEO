"use client";

import { useActionState, useState } from "react";
import { addDomainAction, type ActionResult } from "@/app/domains/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

export interface NicheOption {
  vertical: string;
  /** Markets with a real traffic score. Shown because "researched" is a matter
   * of degree — a niche with 4 scored markets and one with 300 are both in the
   * list, and picking between them without that number is guessing. */
  scoredMarketCount: number;
  rank: number | null;
}

export function AddDomainForm({ niches }: { niches: NicheOption[] }) {
  const [state, formAction, pending] = useActionState(addDomainAction, initialState);
  const [open, setOpen] = useState(false);

  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.ok) setOpen(false);
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Thêm domain
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Tên domain</span>
          <input
            name="name"
            placeholder="atmovingservices.com"
            className="rounded-md border px-2.5 py-1.5 text-sm"
            autoComplete="off"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Dùng cho niche (tuỳ chọn)</span>
          <select
            name="relevantVertical"
            defaultValue=""
            disabled={niches.length === 0}
            className="rounded-md border bg-transparent px-2.5 py-1.5 text-sm disabled:opacity-60"
          >
            <option value="">— chưa gắn niche nào —</option>
            {niches.map((n) => (
              <option key={n.vertical} value={n.vertical}>
                {n.vertical} · {n.scoredMarketCount} thị trường đã chấm
                {n.rank !== null ? ` · hạng ${n.rank}` : ""}
              </option>
            ))}
          </select>
          {/*
            Danh sách rỗng được nói ra, không để một ô select trống tự giải
            thích. Một dropdown không có lựa chọn nào trông giống hệt một
            dropdown đang tải, và người dùng sẽ chờ thứ không bao giờ tới.
          */}
          {niches.length === 0 && (
            <span className="text-xs text-amber-700">
              Chưa niche nào được nghiên cứu (chưa có thị trường nào được chấm điểm traffic). Thêm domain vẫn được, gắn
              niche sau.
            </span>
          )}
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Sẽ tạo một zone thật trên Cloudflare cho domain này (cần CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID ở Cài đặt).
      </p>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Đang thêm vào Cloudflare..." : "Thêm"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Huỷ
        </Button>
      </div>
      {state.message && <p className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
