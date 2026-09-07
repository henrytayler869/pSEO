"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminPasswordHash, verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, createSessionToken, isConfigured } from "@/lib/auth/session";

export interface LoginState {
  error: string | null;
}

/** A deliberate pause on every failure.
 *
 * scrypt already makes each attempt cost ~100ms, but that cost is paid only
 * when a hash exists to check against. This makes the "not configured" and
 * "wrong password" paths take comparable time, so the form does not tell an
 * outsider which situation they are in, and it puts a floor under how fast
 * anyone can work through a guess list. */
const FAILURE_DELAY_MS = 400;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  const fail = async (error: string): Promise<LoginState> => {
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return { error };
  };

  if (!isConfigured()) {
    // Fails closed and says why, because this one IS a configuration problem
    // the operator needs to see — and it is visible only to someone already
    // looking at the login page of a panel that cannot let anyone in anyway.
    return fail("Chưa cấu hình SESSION_SECRET trên máy chủ — không thể tạo phiên đăng nhập.");
  }

  const hash = await getAdminPasswordHash();
  if (!hash) {
    return fail("Chưa đặt mật khẩu quản trị. Chạy scripts/set-admin-password.ts trên máy chủ.");
  }

  if (!password || !verifyPassword(password, hash)) {
    return fail("Mật khẩu không đúng.");
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true, // JavaScript on the page can never read it, so an XSS cannot steal the session
    sameSite: "lax", // a POST from another site arrives without this cookie
    secure: process.env.NODE_ENV === "production", // https only in production; http locally so dev still works
    path: "/",
    maxAge: 12 * 60 * 60,
  });

  // Only ever a path from our own URL, never a caller-supplied absolute URL —
  // that check is what keeps a login form from becoming an open redirect.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
