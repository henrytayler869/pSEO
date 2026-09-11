"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { isGoal } from "@/lib/publisher/recommend";

export interface GoalActionResult {
  ok: boolean;
  message: string;
}

export async function setGoalAction(_prev: GoalActionResult, formData: FormData): Promise<GoalActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const raw = String(formData.get("goal") ?? "");
  if (!isGoal(raw)) return { ok: false, message: "Mục tiêu không hợp lệ." };

  await prisma.website.update({ where: { id: websiteId }, data: { goal: raw } });
  // Ở đây revalidate là đúng: đổi mục tiêu là đổi TOÀN BỘ danh sách đề xuất,
  // nên cả trang phải dựng lại. Khác với lưu template — ở đó revalidate cuốn
  // mất câu xác nhận mà không đổi gì trên màn hình.
  revalidatePath(`/publisher/${websiteId}`);
  return { ok: true, message: "Đã đổi mục tiêu. Danh sách đề xuất bên dưới đổi theo." };
}
