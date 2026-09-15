"use client";

import { useActionState } from "react";
import { revokeLegacyKeyAction, type ActionResult } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";

const revokeInitialState: ActionResult = { ok: false, message: "" };

function ago(d: Date | null | undefined): string {
  if (!d) return "chưa lần nào";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days === 0) return "hôm nay";
  return `${days} ngày trước`;
}

/**
 * Khoá dùng chung CŨ. Không có nút tạo mới — cố ý.
 *
 * Màn hình này trước đây sinh được khoá dùng chung, và đó là cách một hệ
 * nhiều publisher lặng lẽ quay về một khoá cho tất cả. Khoá mới sinh ở trang
 * của từng publisher.
 */
export function ApiKeyManager({
  exists,
  masked,
  lastUsedAt,
  revokedAt,
}: {
  exists: boolean;
  masked?: string;
  lastUsedAt?: Date | null;
  revokedAt?: Date | null;
}) {
  const [revokeState, revokeAction, revokePending] = useActionState(revokeLegacyKeyAction, revokeInitialState);

  if (!exists) {
    return (
      <p className="text-sm text-muted-foreground">
        Không còn khoá dùng chung. Mỗi publisher dùng khoá riêng — tạo ở trang của publisher đó.
      </p>
    );
  }

  const dead = !!revokedAt;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">Khoá dùng chung (cũ)</span>
        <span className={`text-xs ${dead ? "text-muted-foreground" : "text-amber-700"}`}>
          {dead ? "đã thu hồi" : `còn sống · dùng lần cuối ${ago(lastUsedAt)}`}
        </span>
      </div>
      <code className="rounded bg-muted px-2 py-1 font-mono text-xs">{masked}</code>
      <p className="text-xs text-muted-foreground">
        Khoá này đọc được <strong>mọi niche</strong> và không gắn với publisher nào, nên thu hồi nó là làm chết mọi nơi
        đang dùng cùng lúc. Nó còn ở đây chỉ để site cũ không đứt trong lúc chuyển sang khoá riêng.
      </p>
      {!dead && (
        <p className="text-xs text-muted-foreground">
          Trước khi thu hồi: cấp khoá riêng cho từng publisher, đổi <code className="rounded bg-muted px-1">HQ_API_KEY</code> bên
          publisher, rồi đợi dòng &ldquo;dùng lần cuối&rdquo; ở trên ngừng chạy. Nó ngừng chạy nghĩa là không còn ai cầm khoá này.
        </p>
      )}
      {!dead && (
        <form action={revokeAction}>
          <Button type="submit" variant="destructive" size="sm" disabled={revokePending}>
            {revokePending ? "Đang thu hồi…" : "Thu hồi khoá dùng chung"}
          </Button>
        </form>
      )}
      {revokeState.message && <p className="text-xs text-muted-foreground">{revokeState.message}</p>}
    </div>
  );
}
