"use client";

import { useActionState, useState } from "react";
import { Copy, Check, Eye, EyeOff } from "lucide-react";
import { setAdminPasswordAction, type AdminPasswordResult } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";

const initial: AdminPasswordResult = { ok: false, message: "" };

/**
 * Tài khoản quản trị WordPress của một publisher.
 *
 * KHÔNG có nút "xem mật khẩu hiện tại", và đó không phải thiếu sót. WordPress
 * lưu HASH; không nơi nào giữ bản rõ. Hiện được mật khẩu hiện tại đòi Head
 * Quarter tự lưu bản rõ của mọi publisher, biến CSDL này thành nơi một lần rò
 * rỉ mở được mọi wp-admin.
 *
 * Nên thay vào đó: đổi sang mật khẩu mới rồi hiện MỘT LẦN. Nhu cầu thật là
 * "vào được wp-admin", và cách này giải nó mà không tạo ra kho mật khẩu.
 */
export function WpAdminPassword({
  websiteId,
  username,
  wpConnected,
}: {
  websiteId: string;
  username: string | null;
  wpConnected: boolean;
}) {
  const [state, action, running] = useActionState(setAdminPasswordAction, initial);
  const [own, setOwn] = useState(false);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!wpConnected) {
    return (
      <p className="text-sm text-muted-foreground">
        Site này chưa nối WordPress — điền ô <strong>WordPress REST API</strong> ở phần kết nối trước.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Tài khoản</dt>
        <dd className="font-mono">{username ?? <span className="text-muted-foreground">chưa đặt</span>}</dd>
        <dt className="text-muted-foreground">Mật khẩu</dt>
        <dd className="text-muted-foreground">
          không đọc được — WordPress chỉ lưu bản băm, không nơi nào giữ bản gốc
        </dd>
      </dl>

      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="websiteId" value={websiteId} />
        {own && (
          <input
            name="password"
            type="text"
            minLength={16}
            placeholder="Mật khẩu tự đặt, tối thiểu 16 ký tự"
            className="rounded-lg border border-(--color-border-subtle) px-3 py-2 font-mono text-xs"
            autoComplete="off"
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="secondary" disabled={running || !username}>
            {running ? "Đang đổi…" : own ? "Đặt mật khẩu này" : "Sinh mật khẩu mới"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOwn((v) => !v)} disabled={running}>
            {own ? "Thôi, để hệ thống sinh" : "Tôi tự đặt…"}
          </Button>
        </div>
      </form>

      {state.message && (
        <p className={`text-xs ${state.ok ? "text-muted-foreground" : "text-destructive"}`}>{state.message}</p>
      )}

      {/* Mật khẩu mới: che sẵn, vì ô này nằm trên một trang có thể đang được
          chia sẻ màn hình. Hiện ra là một hành động có chủ ý. */}
      {state.ok && state.password && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950">
          <code className="font-mono text-xs">{shown ? state.password : "•".repeat(state.password.length)}</code>
          <Button type="button" size="sm" variant="ghost" onClick={() => setShown((v) => !v)}>
            {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(state.password!);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="ml-1 text-xs">{copied ? "đã chép" : "chép"}</span>
          </Button>
          <span className="text-xs text-amber-800 dark:text-amber-300">
            Tải lại trang là mất — không lưu ở đâu cả.
          </span>
        </div>
      )}
    </div>
  );
}
