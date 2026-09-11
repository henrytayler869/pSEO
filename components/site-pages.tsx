"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface SitePageRow {
  path: string;
  kind: "home" | "section" | "hub" | "content";
  /** Bao nhiêu ZIP sau trang này đã có đoạn AI, trên tổng số ZIP của nó.
   *
   * Đếm chứ không phải true/false: một thành phố có nhiều ZIP — Chicago có 18
   * — nên "có/chưa" phải nói về một ZIP cụ thể nào đó, và chọn một cái để trả
   * lời là bịa. null khi HQ không biết ZIP nào đứng sau trang. */
  interpretation: { withAi: number; total: number } | null;
}

const KIND_LABEL: Record<SitePageRow["kind"], string> = {
  content: "Trang thị trường",
  hub: "Hub khu vực",
  section: "Trang mục",
  home: "Trang chủ",
};

/**
 * Trang mà site ĐANG PHỤC VỤ, đọc từ sitemap thật.
 *
 * Không phải bài WordPress. Đo 11/9/2026: atmovingservices.com là site
 * Next.js — gọi /wp-json/wp/v2/pages trên chính domain đó trả về trang 404
 * của Next, không phải WordPress. Những trang này dựng từ dataset qua
 * /api/v1, nên không REST nào của WordPress nhìn thấy chúng, và một bảng
 * "bài viết" đọc từ WordPress sẽ mãi mãi báo 0 trong khi site có 158 trang.
 */
export function SitePages({ rows, siteUrl, error }: { rows: SitePageRow[]; siteUrl: string; error: string | null }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("content");

  if (error) {
    return (
      <p className="text-sm text-red-700">
        Không đọc được sitemap: {error}. Đây KHÔNG phải &ldquo;site không có trang nào&rdquo; — chưa đọc được thì chưa
        biết.
      </p>
    );
  }

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);

  const shown = rows
    .filter((r) => r.kind === kind)
    .filter((r) => q.trim() === "" || r.path.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["content", "hub", "section", "home"] as const).map((k) => {
          const n = counts.get(k) ?? 0;
          if (n === 0) return null;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-md border px-3 py-1.5 text-sm ${kind === k ? "border-foreground bg-muted" : "hover:bg-muted/50"}`}
            >
              {KIND_LABEL[k]} <span className="text-muted-foreground">({n})</span>
            </button>
          );
        })}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Lọc theo đường dẫn, ví dụ /ca/ hoặc chicago"
        className="w-full rounded-md border px-2 py-1.5 text-sm"
      />

      <div className="flex flex-col divide-y rounded-lg border">
        {shown.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">Không có trang nào khớp.</p>
        ) : (
          shown.slice(0, 200).map((r) => (
            <div key={r.path} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <a
                href={`${siteUrl.replace(/\/+$/, "")}${r.path}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-sm hover:underline"
              >
                <span className="truncate">{r.path}</span>
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
              </a>
              {r.interpretation !== null && (
                <Badge variant={r.interpretation.withAi > 0 ? "default" : "outline"}>
                  {r.interpretation.withAi}/{r.interpretation.total} ZIP có đoạn AI
                </Badge>
              )}
            </div>
          ))
        )}
      </div>
      {shown.length > 200 && <p className="text-xs text-muted-foreground">Hiện 200/{shown.length} — dùng ô lọc để thu hẹp.</p>}
    </div>
  );
}
