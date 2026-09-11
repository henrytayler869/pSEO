"use client";

import { useActionState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { repairTunnelsAction } from "@/lib/dev/repair";
import type { DevCheck } from "@/lib/dev/health";

const EMPTY = { ok: false, message: "" };

/**
 * Một băng-rôn duy nhất cho mọi phụ thuộc đang hỏng.
 *
 * Chỉ hiện khi CÓ thứ hỏng. Một dải "mọi thứ bình thường" xanh lè trên mọi
 * trang là thứ người ta ngừng đọc sau ngày thứ hai, và lúc nó chuyển đỏ thì
 * cũng không ai nhìn nữa.
 */
export function DevHealthBanner({ checks }: { checks: DevCheck[] }) {
  const [state, action, pending] = useActionState(
    async () => await repairTunnelsAction(),
    EMPTY
  );

  const broken = checks.filter((c) => !c.ok);
  if (broken.length === 0) return null;

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-amber-900">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">
          {broken.map((c) => c.label).join(" và ")} chưa kết nối được — số liệu trên các trang sẽ thiếu hoặc báo lỗi.
        </span>
        <form action={action}>
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} /> Mở lại tunnel
          </Button>
        </form>
        <span className="w-full text-xs">
          {broken.map((c) => `${c.label}: ${c.detail} (sửa tay: ${c.fix})`).join(" · ")}
        </span>
        {state.message && <span className="w-full text-xs font-medium">{state.message} — tải lại trang để kiểm.</span>}
      </div>
    </div>
  );
}
