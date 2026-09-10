"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { createPost, updatePost, trashPost, WordPressError, type WpCredentials } from "@/lib/wordpress/posts";
import { deriveWpApiBaseUrl } from "@/lib/wordpress/rest-api";

export interface PostActionResult {
  ok: boolean;
  message: string;
}

/**
 * Loads the site and its credential, or explains precisely what is missing.
 *
 * "Missing credential" and "wrong credential" produce different sentences on
 * purpose. The first is a setup step nobody has done; the second is a
 * credential that was revoked or a user without edit rights. Telling someone
 * to "check the password" when there is no password sends them looking for a
 * mistake that has not been made.
 */
async function loadWritable(
  websiteId: string
): Promise<{ base: string; creds: WpCredentials } | { error: string }> {
  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) return { error: "Không tìm thấy website." };

  if (!website.wpUsername || !website.wpAppPassword) {
    return {
      error:
        "Website này chưa lưu Application Password nên chỉ ĐỌC được bài, không sửa được. " +
        "Tạo ở wp-admin → Users → Profile → Application Passwords, rồi dán vào phần Cài đặt WordPress ở trang này. " +
        "Đó là mật khẩu riêng cho ứng dụng, thu hồi được mà không đổi mật khẩu đăng nhập.",
    };
  }

  return {
    base: website.wpApiBaseUrl ?? deriveWpApiBaseUrl(website.url),
    creds: {
      username: website.wpUsername,
      applicationPassword: website.wpAppPassword,
      loopbackSecret: website.wpLoopbackSecret,
    },
  };
}

function explain(err: unknown): string {
  if (err instanceof WordPressError) return err.message;
  return err instanceof Error ? err.message : "Thao tác thất bại.";
}

export async function saveWpCredentialsAction(
  _prev: PostActionResult,
  formData: FormData
): Promise<PostActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const username = String(formData.get("wpUsername") ?? "").trim();
  const appPassword = String(formData.get("wpAppPassword") ?? "").trim();

  if (!username || !appPassword) {
    return { ok: false, message: "Cần cả tên đăng nhập và Application Password." };
  }

  try {
    await prisma.website.update({
      where: { id: websiteId },
      // Spaces stripped here as well as at the auth header, because the value
      // is also DISPLAYED back as a masked length — and "24 ký tự" versus
      // "28 ký tự" for the same secret would read as two different values.
      data: { wpUsername: username, wpAppPassword: appPassword.replace(/\s+/g, "") },
    });
    revalidatePath(`/publisher/${websiteId}/posts`);
    return { ok: true, message: `Đã lưu thông tin đăng nhập cho "${username}".` };
  } catch (err) {
    return { ok: false, message: explain(err) };
  }
}

export async function createPostAction(_prev: PostActionResult, formData: FormData): Promise<PostActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  const status = String(formData.get("status") ?? "draft") === "publish" ? "publish" : "draft";

  if (!title) return { ok: false, message: "Bài viết cần có tiêu đề." };

  const loaded = await loadWritable(websiteId);
  if ("error" in loaded) return { ok: false, message: loaded.error };

  try {
    const post = await createPost(loaded.base, loaded.creds, { title, content, status });
    revalidatePath(`/publisher/${websiteId}/posts`);
    return {
      ok: true,
      message:
        `Đã tạo "${post.title}" (${post.status === "publish" ? "đã đăng" : "bản nháp"}).` +
        (post.status === "publish"
          ? " Trang công khai có thể chưa đổi ngay nếu site dùng cache — kiểm lại sau khi revalidate."
          : ""),
    };
  } catch (err) {
    return { ok: false, message: explain(err) };
  }
}

export async function updatePostAction(_prev: PostActionResult, formData: FormData): Promise<PostActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const id = Number(formData.get("id") ?? 0);
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!Number.isInteger(id) || id <= 0) return { ok: false, message: "Thiếu id bài viết." };
  if (!title) return { ok: false, message: "Bài viết cần có tiêu đề." };

  const loaded = await loadWritable(websiteId);
  if ("error" in loaded) return { ok: false, message: loaded.error };

  try {
    const post = await updatePost(loaded.base, loaded.creds, id, {
      title,
      content,
      ...(status === "publish" || status === "draft" ? { status } : {}),
    });
    revalidatePath(`/publisher/${websiteId}/posts`);
    return { ok: true, message: `Đã lưu "${post.title}".` };
  } catch (err) {
    return { ok: false, message: explain(err) };
  }
}

/**
 * Moves a post to the trash.
 *
 * Named `trash`, not `delete`, everywhere it appears — in the action, the
 * button, and the confirmation. The underlying call never passes WordPress's
 * `force=true`, so the post stays restorable from wp-admin. A control labelled
 * "Xoá" that is really "chuyển vào thùng rác" would be a lie in the safe
 * direction, and the reverse — a control labelled "trash" that deletes — is
 * the same lie in the direction that costs a post.
 */
export async function trashPostAction(_prev: PostActionResult, formData: FormData): Promise<PostActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const id = Number(formData.get("id") ?? 0);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, message: "Thiếu id bài viết." };

  const loaded = await loadWritable(websiteId);
  if ("error" in loaded) return { ok: false, message: loaded.error };

  try {
    await trashPost(loaded.base, loaded.creds, id);
    revalidatePath(`/publisher/${websiteId}/posts`);
    return {
      ok: true,
      message: `Đã chuyển bài ${id} vào thùng rác. Khôi phục được trong wp-admin → Posts → Trash.`,
    };
  } catch (err) {
    return { ok: false, message: explain(err) };
  }
}
