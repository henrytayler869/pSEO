"use client";

import { useActionState, useEffect, useRef } from "react";
import { changeAdminPasswordAction, type ActionResult } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionResult = { ok: false, message: "" };

export function ChangePasswordForm({ hasPassword, gateOn }: { hasPassword: boolean; gateOn: boolean }) {
  const [state, formAction, pending] = useActionState(changeAdminPasswordAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the fields once a change succeeds, so three passwords are not left
  // sitting in the DOM of an unattended screen.
  //
  // In an effect, not during render: reading or writing a ref while rendering
  // is what eslint caught in the first version of this file. The
  // compare-with-previous-state pattern used elsewhere in this codebase works
  // for plain state but not for refs.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      {!gateOn ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Bản này đang chạy ở localhost nên <strong>không hỏi đăng nhập</strong>. Mật khẩu đặt ở đây chỉ
          áp dụng cho database của chính máy này — muốn đổi mật khẩu production thì làm trên
          hq.cornships.com.
        </p>
      ) : null}

      {hasPassword ? (
        <Field
          name="current"
          label="Mật khẩu hiện tại"
          autoComplete="current-password"
          hint="Phải nhập lại kể cả khi đang đăng nhập — một phiên chứng minh có người từng đăng nhập, không chứng minh người đang ngồi trước máy là chủ."
        />
      ) : null}

      <Field name="next" label="Mật khẩu mới" autoComplete="new-password" hint="Tối thiểu 8 ký tự." />
      <Field name="confirm" label="Nhập lại mật khẩu mới" autoComplete="new-password" />

      {state.message ? (
        <p role="alert" className={`text-sm ${state.ok ? "text-muted-foreground" : "text-destructive"}`}>
          {state.message}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Đang lưu…" : hasPassword ? "Đổi mật khẩu" : "Đặt mật khẩu"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  autoComplete,
  hint,
}: {
  name: string;
  label: string;
  autoComplete: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="password"
        name={name}
        autoComplete={autoComplete}
        required
        className="max-w-sm rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
