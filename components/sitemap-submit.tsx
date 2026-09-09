"use client";

import { useActionState } from "react";
import { submitSitemapAction, type ActionResult } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";
import type { SubmittedSitemap } from "@/lib/google/search-console";

const initialState: ActionResult = { ok: false, message: "" };

export function SitemapSubmit({
  websiteId,
  siteUrl,
  sitemaps,
  error,
}: {
  websiteId: string;
  siteUrl: string;
  sitemaps: SubmittedSitemap[] | null;
  error: string | null;
}) {
  const [state, formAction, pending] = useActionState(submitSitemapAction, initialState);
  const sitemapUrl = `${siteUrl.replace(/\/+$/, "")}/sitemap.xml`;

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="text-xs text-red-700">{error}</p>
      ) : sitemaps && sitemaps.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs">
          {sitemaps.map((s) => (
            <li key={s.path} className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{s.path}</span>
              <span className={s.errors > 0 ? "text-red-700" : "text-muted-foreground"}>
                {s.isPending ? "đang xử lý" : "đã xử lý"}
                {s.submittedUrls !== null ? ` · ${s.submittedUrls} URL` : ""}
                {s.errors > 0 ? ` · ${s.errors} lỗi` : ""}
                {s.warnings > 0 ? ` · ${s.warnings} cảnh báo` : ""}
                {s.lastSubmitted ? ` · nộp ${new Date(s.lastSubmitted).toLocaleDateString()}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        // "Chưa nộp" nói ra như một trạng thái, không để một danh sách rỗng tự
        // giải thích. Sitemap chưa nộp là chuyện Google không hề biết site có
        // bao nhiêu trang — và nó trông y hệt một site chưa được index.
        <p className="text-xs text-amber-700">
          Search Console chưa nhận sitemap nào cho property này. Google vẫn tự tìm được trang qua liên kết, nhưng chậm
          hơn và không biết trước site có bao nhiêu URL.
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="websiteId" value={websiteId} />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? "Đang nộp..." : "Nộp sitemap"}
          </Button>
          <span className="font-mono text-xs text-muted-foreground">{sitemapUrl}</span>
        </div>
        {state.message && (
          <p className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>
        )}
      </form>
    </div>
  );
}
