"use client";

import { useActionState } from "react";
import { removeDomainAction, type ActionResult } from "@/app/domains/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

export function RemoveDomainButton({ domainId }: { domainId: string }) {
  const [, formAction, pending] = useActionState(removeDomainAction, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={domainId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "..." : "Gỡ"}
      </Button>
    </form>
  );
}
