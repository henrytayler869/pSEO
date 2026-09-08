"use client";

import { useActionState, useState } from "react";
import { updateRevalidateSecretAction, type ActionResult } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

/**
 * Write-only editor for the site's revalidate secret.
 *
 * Takes `hasSecret`, never the secret. The component cannot render what it was
 * never given, which is a stronger guarantee than remembering not to display a
 * value that is sitting right there in props — props reach the browser whether
 * or not anything renders them.
 */
export function RevalidateSecretForm({ websiteId, hasSecret }: { websiteId: string; hasSecret: boolean }) {
  const [state, formAction, pending] = useActionState(updateRevalidateSecretAction, initialState);
  const [value, setValue] = useState("");

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    // Cleared on success only. A failed save keeps the typed value so a
    // rejected secret can be corrected rather than retyped from scratch.
    if (state.ok) setValue("");
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="websiteId" value={websiteId} />
      <p className="text-xs text-muted-foreground">
        Trạng thái hiện tại:{" "}
        {hasSecret ? (
          <span className="font-medium text-green-700">đã đặt</span>
        ) : (
          <span className="font-medium text-amber-700">chưa đặt</span>
        )}
        . Giá trị đã lưu không bao giờ được hiển thị lại — nhập giá trị mới để thay thế, hoặc để trống rồi Lưu để xoá.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Revalidate secret</span>
          <input
            name="revalidateSecret"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={hasSecret ? "•••••••• (nhập để thay thế)" : "Khớp REVALIDATE_SECRET trên site"}
            autoComplete="new-password"
            className="w-72 rounded-md border px-2.5 py-1.5 font-mono text-sm"
          />
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Đang lưu và kiểm..." : "Lưu và kiểm"}
        </Button>
      </div>
      {state.message && <p className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
