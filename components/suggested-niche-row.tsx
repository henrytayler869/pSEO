"use client";

import { useActionState } from "react";
import { runNicheResearchAction, type ActionResult } from "@/app/markets/research/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

export function SuggestedNicheRow({
  vertical,
  label,
  rationale,
}: {
  vertical: string;
  label: string;
  rationale: string;
}) {
  const [state, formAction, pending] = useActionState(runNicheResearchAction, initialState);

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{rationale}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{vertical}</p>
        </div>
        <form action={formAction}>
          <input type="hidden" name="vertical" value={vertical} />
          <Button type="submit" size="sm" variant="secondary" disabled={pending} className="shrink-0">
            {pending ? "Đang chạy..." : "Chạy nghiên cứu"}
          </Button>
        </form>
      </div>
      {state.message && <p className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
    </div>
  );
}
