"use client";

import { useActionState } from "react";
import { removeWebsiteAction, type ActionResult } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

export function RemoveWebsiteButton({ websiteId }: { websiteId: string }) {
  const [, formAction, pending] = useActionState(removeWebsiteAction, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={websiteId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "..." : "Gỡ"}
      </Button>
    </form>
  );
}
