"use client";

import { useActionState, useState } from "react";
import {
  createPublisherKeyAction,
  revokePublisherKeyAction,
  type CreateKeyResult,
  type ActionResult,
} from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";
import type { PublisherKeyRow } from "@/lib/settings/api-key";

const createInitial: CreateKeyResult = { ok: false, message: "" };
const revokeInitial: ActionResult = { ok: false, message: "" };

function used(d: Date | null): string {
  if (!d) return "chưa dùng lần nào";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  return days === 0 ? "dùng hôm nay" : `dùng ${days} ngày trước`;
}

export function PublisherApiKeys({
  websiteId,
  vertical,
  keys,
}: {
  websiteId: string;
  vertical: string;
  keys: PublisherKeyRow[];
}) {
  const [createState, createAction, creating] = useActionState(createPublisherKeyAction, createInitial);
  const [revokeState, revokeAction, revoking] = useActionState(revokePublisherKeyAction, revokeInitial);

  // Giá trị đầy đủ chỉ tồn tại trong đúng một phản hồi của action. Bắt ở đây
  // lúc chuyển trạng thái, vì không props nào lấy lại được nó — cùng khuôn
  // với CredentialFieldRow.
  const [handled, setHandled] = useState(createState);
  const [revealed, setRevealed] = useState<string | null>(null);
  if (createState !== handled) {
    setHandled(createState);
    if (createState.ok && createState.key) setRevealed(createState.key);
  }

  const live = keys.filter((k) => !k.revokedAt);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Publisher gửi khoá trong header <code className="rounded bg-muted px-1 py-0.5">Authorization: Bearer &lt;key&gt;</code> khi gọi{" "}
        <code className="rounded bg-muted px-1 py-0.5">/api/v1</code>. Khoá này chỉ đọc được niche{" "}
        <strong>{vertical}</strong> — gọi niche khác sẽ nhận 403.
      </p>

      {revealed && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">
            Copy ngay. HQ chỉ lưu bản băm, nên đây là lần duy nhất khoá này hiện ra — mất thì tạo khoá khác, không tìm lại được.
          </p>
          <code className="mt-2 block break-all rounded bg-white px-2 py-1 font-mono text-xs">{revealed}</code>
          <p className="mt-2 text-xs text-amber-900">
            Dán vào <code className="rounded bg-white px-1">HQ_API_KEY</code> trong <code className="rounded bg-white px-1">.env</code> của
            publisher.
          </p>
        </div>
      )}

      {live.length > 0 && (
        <ul className="flex flex-col gap-2">
          {live.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="flex flex-col">
                <span className="text-sm">{k.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{k.masked}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{used(k.lastUsedAt)}</span>
                <form action={revokeAction}>
                  <input type="hidden" name="keyId" value={k.id} />
                  <input type="hidden" name="websiteId" value={websiteId} />
                  <Button type="submit" variant="ghost" size="sm" disabled={revoking}>
                    Thu hồi
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {live.length === 0 && <p className="text-sm text-muted-foreground">Chưa có khoá nào còn sống cho publisher này.</p>}

      <form action={createAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="websiteId" value={websiteId} />
        <input
          name="label"
          placeholder="đặt tên, ví dụ: build trên Vercel"
          className="w-72 rounded-md border px-2.5 py-1.5 text-sm"
        />
        <Button type="submit" size="sm" disabled={creating}>
          {creating ? "Đang tạo…" : "Tạo khoá"}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Xoay khoá: tạo khoá mới → đổi bên publisher → đợi dòng &ldquo;dùng&rdquo; của khoá cũ ngừng chạy → thu hồi. Thu hồi trước khi đổi
        là làm site chết trong quãng giữa.
      </p>
      {createState.message && !createState.ok && <p className="text-xs text-destructive">{createState.message}</p>}
      {createState.ok && createState.message && <p className="text-xs text-muted-foreground">{createState.message}</p>}
      {revokeState.message && <p className="text-xs text-muted-foreground">{revokeState.message}</p>}
    </div>
  );
}
