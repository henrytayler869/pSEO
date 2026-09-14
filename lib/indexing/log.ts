import { prisma } from "@/lib/db/prisma";
import { getGoogleAccessToken } from "@/lib/google/service-account";

/**
 * Đọc và ghi log theo dõi index.
 *
 * "Đang index bao nhiêu" là câu hỏi dễ và ít giá trị. Câu hỏi đáng theo dõi
 * là "nó đi theo hướng nào" — và câu đó chỉ trả lời được khi giữ lại từng
 * lần đo, không ghi đè.
 */

export interface UrlRow {
  id: string;
  url: string;
  path: string;
  arm: string;
  provider: string;
  submittedAt: Date;
  indexedAtSubmit: boolean | null;
  latest: { verdict: string; coverageState: string; checkedAt: Date; lastCrawlAt: Date | null } | null;
  /** Số lần đo. 0 nghĩa là CHƯA ĐO, khác hẳn "đo rồi thấy chưa index". */
  checkCount: number;
  /** Đã từng vào chỉ mục rồi rơi ra. Chỉ thấy được nhờ giữ log. */
  droppedOut: boolean;
}

export interface ArmSummary {
  arm: string;
  provider: string;
  total: number;
  indexedNow: number;
  neverChecked: number;
  crawledNotIndexed: number;
  neverCrawled: number;
}

export async function getIndexLog(
  websiteId: string,
  siteUrl: string
): Promise<{ rows: UrlRow[]; arms: ArmSummary[]; daysElapsed: number }> {
  const subs = await prisma.indexSubmission.findMany({
    where: { websiteId },
    orderBy: [{ arm: "asc" }, { url: "asc" }],
    include: { checks: { orderBy: { checkedAt: "desc" } } },
  });

  const rows: UrlRow[] = subs.map((s) => {
    const latest = s.checks[0] ?? null;
    // Từng PASS ở một lần đo cũ mà lần mới nhất không PASS = rơi khỏi chỉ
    // mục. Đây là lý do bảng này tồn tại thay vì hai cột trên IndexSubmission.
    const everPassed = s.checks.some((c) => c.verdict === "PASS");
    return {
      id: s.id,
      url: s.url,
      path: (() => { try { return new URL(s.url).pathname; } catch { return s.url.replace(siteUrl, ""); } })(),
      arm: s.arm,
      provider: s.provider,
      submittedAt: s.submittedAt,
      indexedAtSubmit: s.indexedAtSubmit,
      latest: latest ? { verdict: latest.verdict, coverageState: latest.coverageState, checkedAt: latest.checkedAt, lastCrawlAt: latest.lastCrawlAt } : null,
      checkCount: s.checks.length,
      droppedOut: everPassed && latest?.verdict !== "PASS",
    };
  });

  const byArm = new Map<string, UrlRow[]>();
  for (const r of rows) {
    const k = `${r.arm}|${r.provider}`;
    byArm.set(k, [...(byArm.get(k) ?? []), r]);
  }

  const arms: ArmSummary[] = [...byArm].map(([k, list]) => {
    const [arm, provider] = k.split("|");
    return {
      arm,
      provider,
      total: list.length,
      indexedNow: list.filter((r) => r.latest?.verdict === "PASS").length,
      // Tách riêng "chưa đo": gộp nó vào "chưa index" biến một phép đo chưa
      // chạy thành một kết luận về Google.
      neverChecked: list.filter((r) => r.checkCount === 0).length,
      crawledNotIndexed: list.filter((r) => r.latest && r.latest.verdict !== "PASS" && r.latest.lastCrawlAt).length,
      neverCrawled: list.filter((r) => r.latest && r.latest.verdict !== "PASS" && !r.latest.lastCrawlAt).length,
    };
  });

  // Tính ở đây, không tính trong component: Date.now() trong render làm
  // kết quả đổi giữa hai lần render cùng dữ liệu, và React compiler chặn
  // đúng vì lý do đó.
  const oldest = rows.reduce<Date | null>((a, r) => (!a || r.submittedAt < a ? r.submittedAt : a), null);
  const daysElapsed = oldest ? (Date.now() - oldest.getTime()) / 86400000 : 0;

  return { rows, arms, daysElapsed };
}

/** Hỏi GSC trạng thái hiện tại của mọi URL đang theo dõi và GHI THÊM một
 * dòng log cho mỗi cái. Không cập nhật tại chỗ — xem chú thích model. */
export async function recheckAll(websiteId: string, gscPropertyUrl: string): Promise<{ checked: number; failed: number }> {
  const subs = await prisma.indexSubmission.findMany({ where: { websiteId }, select: { id: true, url: true } });
  if (subs.length === 0) return { checked: 0, failed: 0 };

  const token = await getGoogleAccessToken(["https://www.googleapis.com/auth/webmasters.readonly"]);
  let checked = 0;
  let failed = 0;
  const CONCURRENCY = 4;

  for (let i = 0; i < subs.length; i += CONCURRENCY) {
    await Promise.all(
      subs.slice(i, i + CONCURRENCY).map(async (s) => {
        try {
          const res = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ inspectionUrl: s.url, siteUrl: gscPropertyUrl }),
          });
          if (!res.ok) {
            // Lỗi cũng GHI LOG, với verdict ERROR. Bỏ qua nó sẽ tạo một
            // khoảng trống trong log mà sau này không ai giải thích được —
            // và im lặng thì lần đo hỏng trông y như lần đo không đổi gì.
            await prisma.indexCheck.create({ data: { submissionId: s.id, verdict: "ERROR", coverageState: `HTTP ${res.status}` } });
            failed++;
            return;
          }
          const b = (await res.json()) as {
            inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string } };
          };
          const r = b.inspectionResult?.indexStatusResult;
          await prisma.indexCheck.create({
            data: {
              submissionId: s.id,
              verdict: r?.verdict ?? "ERROR",
              coverageState: r?.coverageState ?? "(thiếu indexStatusResult)",
              lastCrawlAt: r?.lastCrawlTime ? new Date(r.lastCrawlTime) : null,
            },
          });
          checked++;
        } catch (err) {
          await prisma.indexCheck.create({
            data: { submissionId: s.id, verdict: "ERROR", coverageState: err instanceof Error ? err.message.slice(0, 80) : "lỗi không rõ" },
          });
          failed++;
        }
      })
    );
  }
  return { checked, failed };
}
