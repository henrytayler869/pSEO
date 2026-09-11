import { prisma } from "@/lib/db/prisma";
import { deriveWpApiBaseUrl } from "@/lib/wordpress/rest-api";

/**
 * "Vào localhost thì mọi thứ có chạy không" — hỏi một lần, trả lời một chỗ.
 *
 * Trước đây mỗi trang tự phát hiện phụ thuộc của mình hỏng theo kiểu riêng:
 * trang Bài viết in "fetch failed", trang Tạo bài viết đổ lỗi Prisma, trang
 * Tổng quan hiện số 0. Ba triệu chứng cho cùng một nguyên nhân — tunnel đứt —
 * và không màn hình nào nói ra nguyên nhân đó.
 *
 * CHỈ CHẠY Ở DEV. Trên VPS thì Postgres và WordPress đều là loopback thật,
 * không có tunnel nào để đứt, nên băng-rôn này ở production sẽ là một câu hỏi
 * không có nghĩa.
 */

export interface DevCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Lệnh sửa, để người đọc không phải đi tìm. */
  fix: string;
}

/** Cache ngắn: layout chạy mỗi lần tải trang, và hỏi WordPress mỗi lần sẽ
 * biến một phép kiểm sức khoẻ thành một khoản phí cố định trên mọi trang. */
let cache: { at: number; checks: DevCheck[] } | null = null;
const TTL_MS = 15_000;

async function checkDb(): Promise<DevCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { id: "db", label: "Database", ok: true, detail: "Kết nối được qua tunnel 55433.", fix: "" };
  } catch (err) {
    return {
      id: "db",
      label: "Database",
      ok: false,
      detail: err instanceof Error ? err.message.split("\n")[0] : "Không kết nối được.",
      fix: "npm run db:tunnel",
    };
  }
}

async function checkWordPress(): Promise<DevCheck | null> {
  const site = await prisma.website.findFirst({ select: { url: true, wpApiBaseUrl: true } }).catch(() => null);
  // Không có website nào thì không có WordPress để hỏi — và một dòng "hỏng"
  // lúc đó sẽ là lỗi bịa cho một thứ chưa tồn tại.
  if (!site) return null;

  const base = site.wpApiBaseUrl ?? deriveWpApiBaseUrl(site.url);
  try {
    const res = await fetch(`${base}/posts?per_page=1`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) {
      return { id: "wp", label: "WordPress", ok: false, detail: `Trả HTTP ${res.status}.`, fix: "npm run wp:tunnel" };
    }
    return { id: "wp", label: "WordPress", ok: true, detail: "Đọc được qua tunnel 8090.", fix: "" };
  } catch (err) {
    return {
      id: "wp",
      label: "WordPress",
      ok: false,
      detail: err instanceof Error ? err.message : "Không tới được.",
      fix: "npm run wp:tunnel",
    };
  }
}

export async function devHealth(): Promise<DevCheck[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.checks;
  const db = await checkDb();
  // Không hỏi WordPress khi database đã hỏng: danh tính site nằm trong
  // database, nên câu trả lời lúc đó chỉ là hệ quả của lỗi bên trên và sẽ
  // khiến một nguyên nhân trông như hai.
  const wp = db.ok ? await checkWordPress() : null;
  const checks = [db, ...(wp ? [wp] : [])];
  cache = { at: Date.now(), checks };
  return checks;
}

export function clearDevHealthCache() {
  cache = null;
}
