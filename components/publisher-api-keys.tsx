"use client";

import { useActionState, useState } from "react";
import {
  createPublisherKeyAction,
  revokePublisherKeyAction,
  type CreateKeyResult,
  type ActionResult,
} from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";
import type { PublisherKeyRow } from "@/lib/settings/api-key";
import type { CourierSite } from "@/lib/publisher/couriers";

const createInitial: CreateKeyResult = { ok: false, message: "" };
const revokeInitial: ActionResult = { ok: false, message: "" };

function used(d: Date | null): string {
  if (!d) return "chưa dùng lần nào";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  return days === 0 ? "dùng hôm nay" : `dùng ${days} ngày trước`;
}

export function PublisherApiKeys({
  websiteId,
  vertical,
  keys,
  hasSecret,
  couriers,
}: {
  websiteId: string;
  vertical: string;
  keys: PublisherKeyRow[];
  /** Site này có revalidate secret dùng được hay chưa. Không có thì đẩy thẳng
   * chắc chắn hụt, và ô chọn phải nói ra điều đó TRƯỚC khi ai bấm. */
  hasSecret: boolean;
  couriers: CourierSite[];
}) {
  const [createState, createAction, creating] = useActionState(createPublisherKeyAction, createInitial);
  const [revokeState, revokeAction, revoking] = useActionState(revokePublisherKeyAction, revokeInitial);

  // Giá trị đầy đủ chỉ tồn tại trong đúng một phản hồi của action. Bắt ở đây
  // lúc chuyển trạng thái, vì không props nào lấy lại được nó — cùng khuôn
  // với CredentialFieldRow.
  const [handled, setHandled] = useState(createState);
  const [revealed, setRevealed] = useState<string | null>(null);
  if (createState !== handled) {
    setHandled(createState);
    // Chỉ hiện khoá khi ĐẨY HỤT. Đẩy được rồi thì không ai cần nhìn thấy nó,
    // và một bí mật hiện ra không lý do là một bí mật sẽ nằm trong ảnh chụp
    // màn hình.
    if (createState.ok && createState.key && createState.pushed !== true) setRevealed(createState.key);
  }

  const live = keys.filter((k) => !k.revokedAt);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Bấm <em>Tạo khoá</em> là khoá được sinh ra và <strong>đẩy thẳng sang site</strong> qua revalidate secret — không phải mở{" "}
        <code className="rounded bg-muted px-1 py-0.5">.env</code>, không phải restart. Khoá chỉ đọc được niche{" "}
        <strong>{vertical}</strong>; gọi niche khác nhận 403.
      </p>

      {createState.ok && createState.pushed === true && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3">
          <p className="text-xs text-green-900">{createState.message}</p>
          <p className="mt-1 text-xs text-green-900">
            Khoá đi thẳng từ đây sang site, không hiện ra màn hình và không cần mở <code className="rounded bg-white px-1">.env</code>.
          </p>
        </div>
      )}

      {revealed && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">
            Chưa đẩy sang site được, nên phải đặt tay. Copy ngay — HQ chỉ lưu bản băm, đây là lần duy nhất khoá hiện ra.
          </p>
          <code className="mt-2 block break-all rounded bg-white px-2 py-1 font-mono text-xs">{revealed}</code>
          <p className="mt-2 text-xs text-amber-900">
            Dán vào <code className="rounded bg-white px-1">HQ_API_KEY</code> trong <code className="rounded bg-white px-1">.env.production</code>{" "}
            của publisher rồi restart service.
          </p>
        </div>
      )}

      {live.length > 0 && (
        <ul className="flex flex-col gap-2">
          {live.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="flex flex-col">
                <span className="text-sm">{k.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{k.masked}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{used(k.lastUsedAt)}</span>
                <form action={revokeAction}>
                  <input type="hidden" name="keyId" value={k.id} />
                  <input type="hidden" name="websiteId" value={websiteId} />
                  <Button type="submit" variant="ghost" size="sm" disabled={revoking}>
                    Thu hồi
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {live.length === 0 && <p className="text-sm text-muted-foreground">Chưa có khoá nào còn sống cho publisher này.</p>}

      <form action={createAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="websiteId" value={websiteId} />
        <input
          name="label"
          placeholder="đặt tên, ví dụ: build trên Vercel"
          className="w-72 rounded-md border px-2.5 py-1.5 text-sm"
        />
        {couriers.length > 0 && (
          <select name="via" defaultValue="" className="rounded-md border px-2.5 py-1.5 text-sm">
            <option value="">
              {hasSecret ? "đẩy thẳng sang site này" : "đẩy thẳng (site này chưa có secret → sẽ hụt)"}
            </option>
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>
                đi qua {c.name}
              </option>
            ))}
          </select>
        )}
        <Button type="submit" size="sm" disabled={creating}>
          {creating ? "Đang tạo…" : "Tạo khoá"}
        </Button>
      </form>
      {couriers.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <strong>Đi qua site khác</strong> dùng khi site này chưa trả lời được — DNS chưa phân giải, chứng chỉ chưa có, hoặc chưa
          có revalidate secret riêng. Mọi publisher chạy từ một kho và ghi vào cùng một file khoá, nên đẩy qua host nào cũng tới
          đúng chỗ; host đích đi trong nội dung yêu cầu. Chọn site vừa deploy xanh gần nhất, và <em>phải chọn</em> — đẩy thẳng hụt
          thì báo hụt, không tự đổi đường.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Xoay khoá: tạo khoá mới → đổi bên publisher → đợi dòng &ldquo;dùng&rdquo; của khoá cũ ngừng chạy → thu hồi. Thu hồi trước khi đổi
        là làm site chết trong quãng giữa.
      </p>
      {createState.message && !createState.ok && <p className="text-xs text-destructive">{createState.message}</p>}
      {createState.ok && createState.pushed !== true && createState.message && (
        <p className="text-xs text-amber-700">{createState.message}</p>
      )}
      {revokeState.message && <p className="text-xs text-muted-foreground">{revokeState.message}</p>}
    </div>
  );
}
