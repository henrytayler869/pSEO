"use client";

import { useActionState } from "react";
import { refreshDomainAction, type ActionResult } from "@/app/domains/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

export function RefreshDomainButton({ domainId }: { domainId: string }) {
  const [state, formAction, pending] = useActionState(refreshDomainAction, initialState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={domainId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "..." : "Kiểm tra lại"}
      </Button>
      {state.message && <p className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
