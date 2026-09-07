"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { ActionResult } from "@/app/collector/actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionResult = { ok: false, message: "" };

export function RunCollectionForm({
  action,
  label,
  pendingLabel,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  label: string;
  pendingLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? pendingLabel : label}
      </Button>
      {state.message && (
        <Alert className={state.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
          <AlertDescription>
            {state.message}{" "}
            {state.snapshotId && (
              <Link href={`/collector/${state.snapshotId}`} className="underline font-medium">
                Xem chi tiết
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
    </form>
  );
}
