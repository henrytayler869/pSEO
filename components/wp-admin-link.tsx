"use client";

import { useState } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import type { WpAdminLink } from "@/lib/wordpress/rest-api";

/**
 * The WordPress admin address for a site.
 *
 * Two shapes, because two situations. A publicly reachable WordPress gets a
 * plain link that opens. A loopback one gets the address AND the command that
 * makes the address reachable — because rendering `http://127.0.0.1:8090/wp-admin`
 * as an ordinary link would be a lie the size of one click: it opens the
 * browser's own machine, finds nothing, and reads as WordPress being down.
 *
 * The tunnel command is offered as copy-to-clipboard rather than as prose,
 * since the whole reason it is on screen is that nobody should have to
 * reconstruct it from memory at the moment they need it.
 */
export function WpAdminLinkCell({ link }: { link: WpAdminLink }) {
  const [copied, setCopied] = useState(false);

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
    <div className="flex flex-col gap-1">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-mono text-xs underline underline-offset-2"
        title="Chỉ mở được khi đã có tunnel tới máy chủ"
      >
        {link.url.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3" />
      </a>
      <span className="text-xs text-muted-foreground">
        WordPress chỉ nghe trên loopback của máy chủ — cần tunnel trước khi mở.
      </span>
      {link.tunnelHint && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(link.tunnelHint!);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="inline-flex w-fit items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "đã chép" : link.tunnelHint}
        </button>
      )}
    </div>
  );
}
