"use client";

import { useActionState, useState } from "react";
import { saveCredentialsAction, clearCredentialAction, type ActionResult } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

export function CredentialFieldRow({
  name,
  label,
  helpText,
  secret,
  status,
  masked,
}: {
  name: string;
  label: string;
  helpText?: string;
  secret: boolean;
  status: "settings" | "env" | "none";
  masked?: string;
}) {
  const [saveState, saveAction, savePending] = useActionState(saveCredentialsAction, initialState);
  const [clearState, clearAction, clearPending] = useActionState(clearCredentialAction, initialState);
  const [value, setValue] = useState("");

  // Track whichever of the two independent action states most recently
  // completed, so the status line reflects the last thing the user did
  // (save vs. clear) instead of always favoring one. Detected during render
  // rather than in an effect (React's documented alternative to
  // useEffect+setState for "reset derived state when a value changes").
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const [handledSaveState, setHandledSaveState] = useState(saveState);
  const [handledClearState, setHandledClearState] = useState(clearState);
  if (saveState !== handledSaveState) {
    setHandledSaveState(saveState);
    setLastResult(saveState);
    if (saveState.ok) setValue("");
  }
  if (clearState !== handledClearState) {
    setHandledClearState(clearState);
    setLastResult(clearState);
  }

  const statusLabel =
    status === "settings"
      ? `Đã lưu trong Cài đặt (${masked})`
      : status === "env"
        ? `Đang dùng từ .env (${masked})`
        : "Chưa cấu hình";
  const statusColor =
    status === "settings" ? "text-green-700" : status === "env" ? "text-blue-700" : "text-muted-foreground";

  return (
    <div className="flex flex-col gap-1.5 border-b py-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <label htmlFor={name} className="text-sm font-medium">
          {label}
        </label>
        <span className={`text-xs ${statusColor}`}>{statusLabel}</span>
      </div>
      {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
      <div className="flex items-center gap-2">
        <form action={saveAction} className="flex flex-1 items-center gap-2">
          <input
            id={name}
            name={name}
            type={secret ? "password" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={status === "none" ? "Chưa có giá trị" : "Để trống nếu không đổi"}
            className="flex-1 rounded-md border px-2.5 py-1.5 text-sm"
            autoComplete="off"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={savePending || !value.trim()}>
            {savePending ? "Đang lưu..." : "Lưu"}
          </Button>
        </form>
        {status === "settings" && (
          <form action={clearAction}>
            <input type="hidden" name="name" value={name} />
            <Button type="submit" size="sm" variant="outline" disabled={clearPending}>
              {clearPending ? "..." : "Xoá"}
            </Button>
          </form>
        )}
      </div>
      {lastResult?.message && (
        <p className={`text-xs ${lastResult.ok ? "text-green-700" : "text-red-700"}`}>{lastResult.message}</p>
      )}
    </div>
  );
}
