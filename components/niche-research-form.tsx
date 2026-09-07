"use client";

import { useActionState } from "react";
import { runNicheResearchAction, type ActionResult } from "@/app/markets/research/actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionResult = { ok: false, message: "" };

export function NicheResearchForm() {
  const [state, formAction, pending] = useActionState(runNicheResearchAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="vertical" className="text-sm font-medium">
          Tên niche
        </label>
        <input
          id="vertical"
          name="vertical"
          required
          placeholder="ví dụ: tax-relief, solar-installation, senior-care"
          className="w-full max-w-md rounded-md border px-3 py-2 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Tự động chuẩn hóa thành dạng viết-thường-có-gạch-ngang. Chạy toàn bộ trên danh sách zip thật hiện có —
          không cần file coverage/network.
        </p>
      </div>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Đang chạy nghiên cứu..." : "Chạy nghiên cứu niche"}
      </Button>
      {state.message && (
        <Alert className={state.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
