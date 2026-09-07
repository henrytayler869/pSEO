import { verifyPassword } from "./password";

/** Matches scripts/set-admin-password.ts — the two ways to set this password
 * must not disagree on what counts as acceptable. */
export const MIN_PASSWORD_LENGTH = 8;

export type ChangeDecision = { ok: true } | { ok: false; reason: string; slow?: boolean };

/**
 * Whether a password change is allowed. Pure, so it can be tested.
 *
 * Extracted because one branch here is security-critical and the rest is
 * ordinary validation: when a password already exists, the CURRENT one must be
 * supplied and must verify. A session proves someone authenticated at some
 * point, not that the person at the keyboard now is the owner — an unattended
 * browser, a stolen cookie and a borrowed laptop all carry a valid session.
 * Asking again at the moment of change is what stops a session from being
 * silently converted into permanent ownership of the account.
 *
 * `slow` marks the answers that must be delayed before returning. Without it,
 * this becomes a fast oracle for guessing the current password from inside a
 * session that already has one.
 */
export function decidePasswordChange(input: {
  existingHash: string | null;
  current: string;
  next: string;
  confirm: string;
}): ChangeDecision {
  if (input.next.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Mật khẩu mới phải dài tối thiểu ${MIN_PASSWORD_LENGTH} ký tự.` };
  }
  if (input.next !== input.confirm) {
    return { ok: false, reason: "Hai ô mật khẩu mới không khớp." };
  }

  // No password yet: nothing to ask for. This is the normal state on a machine
  // with the gate off, and the bootstrap path on one with it on.
  if (!input.existingHash) return { ok: true };

  if (!input.current) return { ok: false, reason: "Phải nhập mật khẩu hiện tại." };
  if (!verifyPassword(input.current, input.existingHash)) {
    return { ok: false, reason: "Mật khẩu hiện tại không đúng.", slow: true };
  }
  if (input.next === input.current) return { ok: false, reason: "Mật khẩu mới trùng mật khẩu cũ." };

  return { ok: true };
}
