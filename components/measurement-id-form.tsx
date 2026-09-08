"use client";

import { useActionState } from "react";
import { updateMeasurementIdAction, type ActionResult } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

export function MeasurementIdForm({ websiteId, current }: { websiteId: string; current: string | null }) {
  const [state, formAction, pending] = useActionState(updateMeasurementIdAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="websiteId" value={websiteId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">GA4 Measurement ID</span>
          <input
            name="ga4MeasurementId"
            defaultValue={current ?? ""}
            placeholder="G-XXXXXXXXXX"
            autoComplete="off"
            className="w-64 rounded-md border px-2.5 py-1.5 font-mono text-sm"
          />
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Đang lưu..." : "Lưu"}
        </Button>
      </div>
      {state.message && <p className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
