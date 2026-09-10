"use client";

import { useState } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import type { WpAdminLink } from "@/lib/wordpress/rest-api";

function CopyChip({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex w-fit max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-left font-mono text-[11px] hover:bg-muted"
      title={`Chép: ${value}`}
    >
      {copied ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
      <span className="truncate">{copied ? "đã chép" : (label ?? value)}</span>
    </button>
  );
}

/**
 * The WordPress admin address for a site.
 *
 * Two shapes, because two situations. A publicly reachable WordPress gets a
 * plain link that opens. A loopback one gets the address AND the command that
 * makes the address reachable.
 *
 * The loopback address is deliberately NOT an anchor. It was one until
 * 2026-09-10, with a comment right here saying an anchor "would be a lie the
 * size of one click" — the comment was right and the code below it did the
 * opposite, which is how it survived review: anyone reading the file read the
 * intent and stopped there.
 *
 * The click cost more than a wasted click. Measured the same day:
 * atmovingservices.com/wp-admin is 404, its /wp-json is 404, and
 * hq.cornships.com has no proxy to 8090 — WordPress has no public entrance at
 * all. So the anchor fails from every browser that is not on the VPS, and it
 * fails with whatever the browser decides to call an unreachable loopback
 * port. The person who clicks it is then debugging DNS, or WordPress, instead
 * of reading the one sentence underneath that already explains it.
 *
 * A control that cannot work should not look like a control. The address is
 * still here to be copied — after the tunnel is up it is exactly what goes in
 * the address bar — but nothing on screen now promises a click will do it.
 */
export function WpAdminLinkCell({ link }: { link: WpAdminLink }) {
  if (!link.serverOnly) {
    return (
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
      >
        wp-admin <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <CopyChip value={link.url} label={link.url.replace(/^https?:\/\//, "")} />
      <span className="text-xs text-muted-foreground">
        WordPress chỉ nghe trên loopback của máy chủ và không có cửa công khai nào. Chạy tunnel bên dưới trước, rồi dán
        địa chỉ trên vào trình duyệt — bấm thẳng sẽ không mở được.
      </span>
      {link.tunnelHint && <CopyChip value={link.tunnelHint} />}
    </div>
  );
}
