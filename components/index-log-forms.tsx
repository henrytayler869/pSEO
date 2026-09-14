"use client";

import { useActionState } from "react";
import { recheckAction, recordManualAction, type IndexActionResult } from "@/app/publisher/[websiteId]/index-log/actions";
import { Button } from "@/components/ui/button";

const initial: IndexActionResult = { ok: false, message: "" };

export function RecheckButton({ websiteId, count }: { websiteId: string; count: number }) {
  const [state, action, pending] = useActionState(recheckAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="websiteId" value={websiteId} />
      <Button type="submit" size="sm" disabled={pending || count === 0}>
        {pending ? `Đang hỏi Google ${count} URL…` : `Đo lại ${count} URL`}
      </Button>
      <span className="text-xs text-muted-foreground">
        Mỗi lần đo ghi thêm một dòng log, không ghi đè lần trước.
      </span>
      {state.message && <p className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}

export function RecordManualForm({ websiteId }: { websiteId: string }) {
  const [state, action, pending] = useActionState(recordManualAction, initial);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="websiteId" value={websiteId} />
      <textarea
        name="urls"
        rows={4}
        placeholder={"/moving-services/ny\n/moving-services/tx\nhoặc dán URL đầy đủ, mỗi dòng một cái"}
        className="w-full rounded-md border px-2.5 py-1.5 font-mono text-xs"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Đang ghi…" : "Ghi mốc bấm tay"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Ghi kèm trạng thái index tại thời điểm bấm — không có mốc đó thì lần đo sau không so được với gì.
        </span>
      </div>
      {state.message && <p className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
