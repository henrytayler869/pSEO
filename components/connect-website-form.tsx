"use client";

import { useActionState, useState } from "react";
import { connectWebsiteAction, type ActionResult } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

export function ConnectWebsiteForm() {
  const [state, formAction, pending] = useActionState(connectWebsiteAction, initialState);
  const [open, setOpen] = useState(false);

  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.ok) setOpen(false);
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Kết nối website mới
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field name="name" label="Tên website" placeholder="VD: Moving Help Hub" />
        <Field name="url" label="URL" placeholder="https://example.com" />
        <Field name="gscPropertyUrl" label="GSC property" placeholder="sc-domain:example.com" />
        <Field name="ga4PropertyId" label="GA4 property ID" placeholder="123456789" />
        <Field name="wpApiBaseUrl" label="WP REST API base (tuỳ chọn)" placeholder="Mặc định: {URL}/wp-json/wp/v2" />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Đang kết nối..." : "Kết nối"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Huỷ
        </Button>
      </div>
      {state.message && <p className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}

function Field({ name, label, placeholder }: { name: string; label: string; placeholder: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input name={name} placeholder={placeholder} className="rounded-md border px-2.5 py-1.5 text-sm" autoComplete="off" />
    </label>
  );
}
