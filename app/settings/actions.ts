"use server";

import { revalidatePath } from "next/cache";
import { setCredentials, clearCredential, CREDENTIAL_FIELDS } from "@/lib/settings/credentials";
import { generateApiKey, revokeApiKey } from "@/lib/settings/api-key";
import { saveServiceAccountKey, clearServiceAccountKey } from "@/lib/google/service-account";

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
