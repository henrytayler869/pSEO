"use client";

import { useActionState } from "react";
import { setRegistrarNameserversAction, type ActionResult } from "@/app/domains/actions";
import { Button } from "@/components/ui/button";

const initial: ActionResult = { ok: false, message: "" };

/**
 * Đặt nameserver Cloudflare tại registrar Gname.
 *
 * Tách khỏi "Làm mới": làm mới chỉ ĐỌC trạng thái từ Cloudflare, nút này GHI
 * vào registrar đang giữ domain thật. Hai việc khác hẳn nhau về hậu quả, nên
 * chúng là hai nút.
 *
 * Thông báo hiện nguyên văn, kể cả khi dài. Lỗi hay gặp nhất ở đây — Gname
 * chặn IP — trông giống hệt lỗi mạng, và cắt ngắn thông báo sẽ lấy mất đúng
 * câu phân biệt hai cái đó.
 */
export function SetNameserversButton({ domainId, nameServers }: { domainId: string; nameServers: string[] }) {
  const [state, action, pending] = useActionState(setRegistrarNameserversAction, initial);

  if (nameServers.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <form action={action}>
        <input type="hidden" name="id" value={domainId} />
        <Button type="submit" size="sm" variant="ghost" disabled={pending}>
          {pending ? "Đang gọi Gname…" : "Đặt NS tại Gname"}
        </Button>
      </form>
      {state.message && (
        <p className={`max-w-md text-xs ${state.ok ? "text-muted-foreground" : "text-destructive"}`}>{state.message}</p>
      )}
    </div>
  );
}
