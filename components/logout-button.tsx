"use client";

import { useActionState } from "react";
import { logout } from "@/app/login/actions";
import { LogOut } from "lucide-react";

/** Rendered only when the gate is on — see Sidebar. A logout control on a
 * panel that never asked for a login is a button that does nothing, which is
 * worse than no button. */
export function LogoutButton() {
  const [, formAction, pending] = useActionState(async () => {
    await logout();
  }, undefined);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-50"
      >
        <LogOut className="h-4 w-4 shrink-0" />
        {pending ? "Đang thoát…" : "Đăng xuất"}
      </button>
    </form>
  );
}
