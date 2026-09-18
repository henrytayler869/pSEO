"use client";

import { useActionState, useState } from "react";
import { provisionSiteAction, type ProvisionActionResult } from "@/app/domains/actions";
import { Button } from "@/components/ui/button";

const initial: ProvisionActionResult = { ok: false, message: "", steps: [], manual: [] };

const STATUS_LABEL: Record<string, string> = {
  done: "xong",
  skipped: "đã có",
  waiting: "đang chờ",
  failed: "HỎNG",
};

const STATUS_CLASS: Record<string, string> = {
  done: "text-(--color-accent)",
  skipped: "text-(--color-ink-muted)",
  waiting: "text-amber-600 dark:text-amber-400",
  failed: "text-red-600 dark:text-red-400",
};

/**
 * "Dựng Site" — chạy những bước HQ làm được, và IN RA những bước không làm được.
 *
 * Ba lựa chọn giao diện, mỗi cái vì một lý do:
 *
 * 1. Xác nhận bằng cách GÕ LẠI TÊN MIỀN. Nút này tạo GA4 property thật và ghi
 *    A record thật; một hộp thoại "bạn có chắc không" thì bấm qua được bằng
 *    phản xạ, còn gõ tên miền thì không.
 *
 * 2. Hiện TỪNG BƯỚC kèm trạng thái, kể cả bước bỏ qua. Một nút chỉ nói "xong"
 *    hay "thất bại" buộc người bấm đoán nó đã kịp làm gì — và đoán sai ở đây
 *    nghĩa là chạy lại một bước đã xong.
 *
 * 3. Phần việc TAY luôn hiện, kể cả khi mọi bước đều xanh. Ba việc đó — nginx,
 *    chứng chỉ, và bảng site trong repo publisher — không ai làm thay được, và
 *    giấu chúng đi là cách biến một nút trung thực thành một nút nói dối.
 */
export function ProvisionSiteButton({ domainName, vertical }: { domainName: string; vertical: string | null }) {
  const [state, action, pending] = useActionState(provisionSiteAction, initial);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Dựng Site
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border border-(--color-border-subtle) p-4">
      <input type="hidden" name="domainName" value={domainName} />
      <p className="text-sm text-(--color-ink-muted)">
        Tạo GA4 property, ghi A record, nối Website và cấp khoá cho <strong>{domainName}</strong>. Những
        bước cần SSH hoặc đụng repo publisher sẽ được liệt kê, không tự chạy.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <input name="name" placeholder="Tên site" className="rounded-lg border border-(--color-border-subtle) px-3 py-2 text-sm" />
        <input name="vertical" defaultValue={vertical ?? ""} placeholder="Ngành (vertical)" className="rounded-lg border border-(--color-border-subtle) px-3 py-2 text-sm" />
        <input name="serverIp" placeholder="IP máy chủ publisher" className="rounded-lg border border-(--color-border-subtle) px-3 py-2 text-sm" />
        <input name="tagline" placeholder="Tagline — dòng dưới tên site" className="rounded-lg border border-(--color-border-subtle) px-3 py-2 text-sm" />
        <textarea name="description" placeholder="Mô tả — dùng cho thẻ meta description" rows={2} className="rounded-lg border border-(--color-border-subtle) px-3 py-2 text-sm sm:col-span-2" />
      </div>

      <label className="text-sm">
        Gõ lại <code className="font-mono">{domainName}</code> để xác nhận:
        <input name="confirm" autoComplete="off" className="mt-1 w-full rounded-lg border border-(--color-border-subtle) px-3 py-2 font-mono text-sm" />
      </label>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Đang dựng…" : "Dựng Site"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Đóng
        </Button>
      </div>

      {state.message ? (
        <p className={`text-sm ${state.ok ? "text-(--color-ink)" : "text-red-600 dark:text-red-400"}`}>{state.message}</p>
      ) : null}

      {state.steps.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {state.steps.map((s) => (
            <li key={s.key} className="flex gap-2">
              <span className={`w-20 shrink-0 font-medium ${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
              <span className="w-32 shrink-0">{s.title}</span>
              <span className="text-(--color-ink-muted)">{s.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {state.manual.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg bg-(--color-surface) p-3 text-sm">
          <p className="font-medium">Phần này không ai làm thay được:</p>
          {state.manual.map((m) => (
            <div key={m.title}>
              <p className="text-(--color-ink-muted)">{m.title}</p>
              <pre className="mt-1 overflow-x-auto rounded bg-black/5 p-2 font-mono text-xs dark:bg-white/5">
                {m.commands.join("\n")}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </form>
  );
}
