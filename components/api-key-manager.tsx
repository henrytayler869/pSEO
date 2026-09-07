"use client";

import { useActionState, useState } from "react";
import { generateApiKeyAction, revokeApiKeyAction, type GenerateApiKeyResult, type ActionResult } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";

const generateInitialState: GenerateApiKeyResult = { ok: false, message: "" };
const revokeInitialState: ActionResult = { ok: false, message: "" };

export function ApiKeyManager({ configured, masked }: { configured: boolean; masked?: string }) {
  const [generateState, generateAction, generatePending] = useActionState(generateApiKeyAction, generateInitialState);
  const [revokeState, revokeAction, revokePending] = useActionState(revokeApiKeyAction, revokeInitialState);

  // Same "detect the action-state transition during render" pattern as
  // CredentialFieldRow — the plaintext key is only ever available in the
  // single response right after generateApiKeyAction runs, so it has to be
  // captured here rather than re-derived from status props (which only ever
  // carry the masked tail).
  const [handledGenerateState, setHandledGenerateState] = useState(generateState);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  if (generateState !== handledGenerateState) {
    setHandledGenerateState(generateState);
    if (generateState.ok && generateState.key) setRevealedKey(generateState.key);
  }

  const statusLabel = configured ? `Đã tạo (${masked})` : "Chưa tạo";
  const statusColor = configured ? "text-green-700" : "text-muted-foreground";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">API Key</span>
        <span className={`text-xs ${statusColor}`}>{statusLabel}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Website/plugin gửi key này trong header <code className="rounded bg-muted px-1 py-0.5">Authorization: Bearer &lt;key&gt;</code> khi
        gọi <code className="rounded bg-muted px-1 py-0.5">/api/v1</code>. Chỉ một key tại một thời điểm — tạo mới sẽ thay thế key cũ (mọi
        nơi đang dùng key cũ sẽ ngừng hoạt động).
      </p>
      {revealedKey && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5">
          <p className="text-xs font-medium text-amber-900">Lưu lại ngay — sẽ không hiển thị lại dạng đầy đủ:</p>
          <code className="mt-1 block break-all text-xs text-amber-950">{revealedKey}</code>
        </div>
      )}
      <div className="flex items-center gap-2">
        <form action={generateAction}>
          <Button type="submit" size="sm" variant="secondary" disabled={generatePending}>
            {generatePending ? "Đang tạo..." : configured ? "Tạo lại (thu hồi key cũ)" : "Tạo API key mới"}
          </Button>
        </form>
        {configured && (
          <form action={revokeAction}>
            <Button type="submit" size="sm" variant="outline" disabled={revokePending}>
              {revokePending ? "..." : "Thu hồi"}
            </Button>
          </form>
        )}
      </div>
      {revokeState.message && <p className="text-xs text-green-700">{revokeState.message}</p>}
    </div>
  );
}
