"use client";

import { useActionState, useState } from "react";
import { saveServiceAccountKeyAction, clearServiceAccountKeyAction, type ActionResult } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

export function ServiceAccountManager({ configured, clientEmail }: { configured: boolean; clientEmail?: string }) {
  const [saveState, saveAction, savePending] = useActionState(saveServiceAccountKeyAction, initialState);
  const [clearState, clearAction, clearPending] = useActionState(clearServiceAccountKeyAction, initialState);
  const [value, setValue] = useState("");

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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">Service Account JSON</span>
        <span className={`text-xs ${configured ? "text-green-700" : "text-muted-foreground"}`}>
          {configured ? (clientEmail ? `Đã kết nối (${clientEmail})` : "Đã lưu (không đọc được email)") : "Chưa cấu hình"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Tạo Service Account trên Google Cloud Console, tải file JSON key, dán nguyên nội dung vào đây. Sau đó thêm{" "}
        <strong>{clientEmail ?? "email service account"}</strong> làm viewer trên từng property Search Console và Google Analytics 4 của
        website muốn kết nối ở tab Publisher.
      </p>
      <form action={saveAction} className="flex flex-col gap-2">
        <textarea
          name="serviceAccountJson"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder='{"type": "service_account", "client_email": "...", "private_key": "...", ...}'
          rows={4}
          className="w-full rounded-md border px-2.5 py-1.5 font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" variant="secondary" disabled={savePending || !value.trim()}>
            {savePending ? "Đang lưu..." : "Lưu"}
          </Button>
        </div>
      </form>
      {configured && (
        <form action={clearAction}>
          <Button type="submit" size="sm" variant="outline" disabled={clearPending}>
            {clearPending ? "..." : "Xoá"}
          </Button>
        </form>
      )}
      {lastResult?.message && (
        <p className={`text-xs ${lastResult.ok ? "text-green-700" : "text-red-700"}`}>{lastResult.message}</p>
      )}
    </div>
  );
}
