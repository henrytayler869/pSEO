"use client";

import { useActionState } from "react";
import { updateSiteIdentityAction, type ActionResult } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";

const initial: ActionResult = { ok: false, message: "" };

/** Độ dài mà Google thường cắt. KHÔNG chặn — chỉ đếm.
 *
 * Chặn cứng ở đây sẽ là luật thứ hai về độ dài, sống cạnh luật đã có trong
 * lib/seo. Hai nơi cùng quyết một chuyện là hai nơi sẽ trôi lệch. Con số này
 * chỉ để người viết thấy mình đang ở đâu. */
const DESC_SOFT_LIMIT = 160;
const TAGLINE_SOFT_LIMIT = 70;

export function SiteIdentityForm({
  websiteId,
  name,
  tagline,
  description,
  missing,
}: {
  websiteId: string;
  name: string;
  tagline: string | null;
  description: string | null;
  missing: { field: string; why: string }[];
}) {
  const [state, action, pending] = useActionState(updateSiteIdentityAction, initial);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="websiteId" value={websiteId} />

      {missing.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">Chưa đủ danh tính để dựng site. Còn thiếu:</p>
          <ul className="mt-1 list-disc pl-4 text-xs text-amber-900">
            {missing.map((m) => (
              <li key={m.field}>
                <code className="rounded bg-white px-1">{m.field}</code> — {m.why}
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Tên site</span>
        <input
          name="name"
          defaultValue={name}
          className="w-full max-w-md rounded-md border px-2.5 py-1.5 text-sm"
          placeholder="AT Moving Services"
        />
        <span className="text-xs text-muted-foreground">Tiêu đề trang và tên thương hiệu.</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Tagline</span>
        <input
          name="tagline"
          defaultValue={tagline ?? ""}
          className="w-full max-w-md rounded-md border px-2.5 py-1.5 text-sm"
          placeholder="Federal moving and housing data, ZIP by ZIP"
        />
        <span className="text-xs text-muted-foreground">
          Dòng ngay dưới tên site. Khoảng {TAGLINE_SOFT_LIMIT} ký tự trở xuống thì không bị cắt ở đa số bố cục.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Description</span>
        <textarea
          name="description"
          defaultValue={description ?? ""}
          rows={3}
          className="w-full max-w-2xl rounded-md border px-2.5 py-1.5 text-sm"
          placeholder="Household migration counts from IRS return data and housing estimates from the Census Bureau, published per ZIP code…"
        />
        <span className="text-xs text-muted-foreground">
          Thẻ <code className="rounded bg-muted px-1">meta description</code>. Để trống là ship một thẻ RỖNG — hỏng SEO mà không
          màn hình nào báo. Google thường cắt quanh {DESC_SOFT_LIMIT} ký tự.
        </span>
      </label>

      <div>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Đang lưu và báo cho site…" : "Lưu danh tính"}
        </Button>
      </div>

      {state.message && (
        <p className={`text-xs ${state.ok ? "text-muted-foreground" : "text-destructive"}`}>{state.message}</p>
      )}
    </form>
  );
}
