"use client";

import { useActionState } from "react";
import { createGa4PropertyAction, type CreateGa4Result } from "@/app/publisher/actions";
import { Button } from "@/components/ui/button";

const initial: CreateGa4Result = { ok: false, message: "" };

/**
 * Tạo GA4 property ngay trong HQ.
 *
 * Chỉ hiện khi website CHƯA có property id. Một nút "tạo" đứng cạnh một
 * property đang chạy là nút người ta sẽ bấm nhầm, và bấm nhầm ở đây đẻ ra
 * property thứ hai trùng tên rồi ghi đè id — số liệu cũ vẫn còn trong
 * property cũ nhưng không ai đọc nữa.
 */
export function Ga4CreateProperty({
  websiteId,
  accounts,
  accountsError,
}: {
  websiteId: string;
  accounts: { name: string; displayName: string }[];
  accountsError: string | null;
}) {
  const [state, action, pending] = useActionState(createGa4PropertyAction, initial);

  if (accountsError) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
        <p className="text-xs font-medium text-amber-900">Chưa tạo GA4 property từ đây được.</p>
        <p className="mt-1 text-xs text-amber-900">{accountsError}</p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Service Account không thấy tài khoản Google Analytics nào. Vào GA4 → Admin → Account access management và thêm nó với
        vai trò Editor ở cấp <strong>tài khoản</strong>.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="websiteId" value={websiteId} />
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Tạo dưới tài khoản Analytics</span>
        <select name="accountName" className="w-full max-w-md rounded-md border px-2.5 py-1.5 text-sm">
          {accounts.map((a) => (
            <option key={a.name} value={a.name}>
              {a.displayName}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        Tạo property <strong>và</strong> luồng dữ liệu web, rồi lưu cả hai id. Hai id đó không suy ra được từ nhau: Property ID
        dùng để <strong>đọc</strong> báo cáo, Measurement ID để site <strong>ghi</strong> sự kiện. Đảo chúng cho nhau thì một
        bên bị từ chối còn bên kia thu thập rỗng — trong khi mọi trang vẫn render.
      </p>
      <div>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Đang tạo trên Google…" : "Tạo GA4 property"}
        </Button>
      </div>
      {state.message && (
        <p className={`text-xs ${state.ok ? "text-muted-foreground" : "text-destructive"}`}>{state.message}</p>
      )}
    </form>
  );
}
