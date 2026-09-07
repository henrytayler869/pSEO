"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

const initialState: LoginState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4 rounded-lg border bg-card p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">pSEO Control Panel</h1>
        <p className="text-sm text-muted-foreground">Nhập mật khẩu quản trị để tiếp tục.</p>
      </div>

      <input type="hidden" name="next" value={next} />

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Mật khẩu</span>
        <input
          type="password"
          name="password"
          // autoFocus so the only field on the page is ready to type into.
          autoFocus
          // Lets a password manager recognise this as a sign-in form and offer
          // to fill and store it — the practical route to a strong password
          // here, since nobody types a long one by hand every day.
          autoComplete="current-password"
          required
          className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Đang kiểm tra…" : "Đăng nhập"}
      </Button>
    </form>
  );
}
