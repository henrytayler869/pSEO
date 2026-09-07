"use client";

import { useActionState } from "react";
import { runAllSuggestedNichesAction, type ActionResult } from "@/app/markets/research/actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionResult = { ok: false, message: "" };

export function RunAllSuggestedNichesForm({ count }: { count: number }) {
  const [state, formAction, pending] = useActionState(runAllSuggestedNichesAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {count > 0 && (
        <Button type="submit" variant="secondary" disabled={pending} className="w-fit">
          {pending ? `Đang chạy ${count} niche...` : `Chạy tất cả ${count} niche gợi ý`}
        </Button>
      )}
      {state.message && (
        <Alert className={state.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
