"use server";

import { revalidatePath } from "next/cache";
import { setCredentials, clearCredential, CREDENTIAL_FIELDS } from "@/lib/settings/credentials";
import { generateApiKey, revokeApiKey } from "@/lib/settings/api-key";
import { saveServiceAccountKey, clearServiceAccountKey } from "@/lib/google/service-account";
import { getAdminPasswordHash, setAdminPassword } from "@/lib/auth/password";
import { decidePasswordChange } from "@/lib/auth/change-password";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function saveServiceAccountKeyAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const rawJson = String(formData.get("serviceAccountJson") ?? "").trim();
  if (!rawJson) return { ok: false, message: "Chưa dán nội dung JSON." };
  try {
    const { client_email } = await saveServiceAccountKey(rawJson);
    revalidatePath("/settings");
    return { ok: true, message: `Đã lưu — dùng email này để mời làm viewer trên GSC/GA4: ${client_email}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Lưu thất bại." };
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this exact (prevState, formData) signature; this action takes no input.
export async function clearServiceAccountKeyAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  await clearServiceAccountKey();
  revalidatePath("/settings");
  return { ok: true, message: "Đã xoá Service Account." };
}

export interface GenerateApiKeyResult {
  ok: boolean;
  message: string;
  key?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this exact (prevState, formData) signature; this action takes no input.
export async function generateApiKeyAction(_prev: GenerateApiKeyResult, _formData: FormData): Promise<GenerateApiKeyResult> {
  const key = await generateApiKey();
  revalidatePath("/settings");
  return { ok: true, message: "Đã tạo API key mới — lưu lại ngay, sẽ không hiển thị lại dạng đầy đủ.", key };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this exact (prevState, formData) signature; this action takes no input.
export async function revokeApiKeyAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  await revokeApiKey();
  revalidatePath("/settings");
  return { ok: true, message: "Đã thu hồi API key." };
}

export async function saveCredentialsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const updates: Record<string, string> = {};
    for (const field of CREDENTIAL_FIELDS) {
      const value = formData.get(field.name);
      if (typeof value === "string") updates[field.name] = value;
    }
    const changedCount = Object.values(updates).filter((v) => v.trim() !== "").length;
    if (changedCount === 0) {
      return { ok: false, message: "Chưa nhập giá trị mới." };
    }
    await setCredentials(updates);
    revalidatePath("/settings");
    return { ok: true, message: "Đã lưu." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Lưu thất bại." };
  }
}

export async function clearCredentialAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "");
  try {
    await clearCredential(name);
    revalidatePath("/settings");
    return { ok: true, message: "Đã xoá." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Xoá thất bại." };
  }
}

/**
 * Changes the admin password from the UI.
 *
 * Requires the CURRENT password even though the caller is already logged in.
 * A session is evidence that someone authenticated at some point, not that the
 * person at the keyboard right now is the owner — an unattended browser, a
 * stolen cookie, or a borrowed laptop all carry a valid session. Asking again
 * at the moment of change is what stops a session from being silently
 * converted into permanent ownership of the account.
 *
 * The exception is bootstrap: with no password set yet there is nothing to ask
 * for, and on a machine with the gate off (localhost) that is the normal state.
 */
export async function changeAdminPasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const existing = await getAdminPasswordHash();
  const next = String(formData.get("next") ?? "");

  const decision = decidePasswordChange({
    existingHash: existing,
    current: String(formData.get("current") ?? ""),
    next,
    confirm: String(formData.get("confirm") ?? ""),
  });

  if (!decision.ok) {
    // Same deliberate pause as the login form, on the answers that would
    // otherwise let someone probe the current password from inside a session.
    if (decision.slow) await new Promise((r) => setTimeout(r, 400));
    return { ok: false, message: decision.reason };
  }

  await setAdminPassword(next);
  revalidatePath("/settings");
  return {
    ok: true,
    message: existing
      ? "Đã đổi mật khẩu. Các phiên đang đăng nhập vẫn còn hiệu lực tới khi hết hạn — phiên ký bằng SESSION_SECRET, không bằng mật khẩu."
      : "Đã đặt mật khẩu quản trị lần đầu.",
  };
}
