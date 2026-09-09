"use client";

import { useActionState, useState } from "react";
import { startOnPageCrawlAction, type ActionResult } from "@/app/publisher/[websiteId]/onpage/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

export function OnPageCrawlForm({
  websiteId,
  maxPages,
  lastCrawlAt,
  hasTask,
}: {
  websiteId: string;
  maxPages: number;
  lastCrawlAt: string | null;
  hasTask: boolean;
}) {
  const [state, formAction, pending] = useActionState(startOnPageCrawlAction, initialState);
  const [pages, setPages] = useState(String(maxPages));

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="websiteId" value={websiteId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Số trang tối đa</span>
          <input
            name="maxPages"
            type="number"
            min={1}
            value={pages}
            onChange={(e) => setPages(e.target.value)}
            className="w-32 rounded-md border px-2.5 py-1.5 text-sm"
          />
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Đang gửi yêu cầu..." : hasTask ? "Quét lại" : "Bắt đầu quét"}
        </Button>
        {lastCrawlAt && (
          <span className="text-xs text-muted-foreground">
            Lần quét gần nhất: {new Date(lastCrawlAt).toLocaleString()}
          </span>
        )}
      </div>
      {state.message && <p className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
