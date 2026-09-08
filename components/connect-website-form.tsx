"use client";

import { useActionState, useState } from "react";
import { connectWebsiteAction, type ActionResult } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

const EMPTY_FIELDS = {
  name: "",
  url: "",
  gscPropertyUrl: "",
  ga4PropertyId: "",
  ga4MeasurementId: "",
  wpApiBaseUrl: "",
  revalidateSecret: "",
};

export function ConnectWebsiteForm() {
  const [state, formAction, pending] = useActionState(connectWebsiteAction, initialState);
  const [open, setOpen] = useState(false);

  /**
   * The typed values are held here rather than left to the DOM.
   *
   * Uncontrolled inputs lose everything when the server action re-renders the
   * form, so a single rejected field — a measurement ID pasted into the wrong
   * box, which is the mistake this form is built to catch — wiped all six and
   * asked the person to type them again. The validation was right and the
   * experience of being corrected was a punishment.
   */
  const [fields, setFields] = useState(EMPTY_FIELDS);

  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.ok) {
      setOpen(false);
      setFields(EMPTY_FIELDS); // only on success — a failure must keep the work
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Kết nối website mới
      </Button>
    );
  }

  const field = (name: keyof typeof EMPTY_FIELDS, label: string, placeholder: string, secret = false) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        name={name}
        type={secret ? "password" : "text"}
        value={fields[name]}
        onChange={(e) => setFields((f) => ({ ...f, [name]: e.target.value }))}
        placeholder={placeholder}
        className="rounded-md border px-2.5 py-1.5 text-sm"
        autoComplete="off"
      />
    </label>
  );

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("name", "Tên website", "VD: Moving Help Hub")}
        {field("url", "URL", "https://example.com")}
        {field("gscPropertyUrl", "GSC property", "sc-domain:example.com")}
        {field("ga4PropertyId", "GA4 property ID (đọc báo cáo)", "553102895")}
        {field("ga4MeasurementId", "GA4 Measurement ID (site gửi sự kiện)", "G-XXXXXXXXXX")}
        {field("wpApiBaseUrl", "WP REST API base (tuỳ chọn)", "Mặc định: {URL}/wp-json/wp/v2")}
        {field("revalidateSecret", "Revalidate secret (tuỳ chọn)", "Khớp REVALIDATE_SECRET trên site", true)}
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
