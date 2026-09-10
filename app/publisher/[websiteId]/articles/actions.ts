"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { discoverCandidates, type ArticleCandidate, type Intent } from "@/lib/article-candidates/discover";
import { buildQcContext, writeArticle } from "@/lib/article-qc/write-loop";
import { createPost, type WpCredentials } from "@/lib/wordpress/posts";
import { deriveWpApiBaseUrl } from "@/lib/wordpress/rest-api";
import type { FactSet } from "@/lib/ai/facts";

export interface ArticleActionResult {
  ok: boolean;
  message: string;
}

function factSetFor(c: ArticleCandidate): FactSet {
  return {
    vertical: c.vertical,
    zip: "",
    city: null,
    state: c.scope.kind === "STATE" ? c.scope.name : "",
    county: c.scope.kind === "COUNTY" ? c.scope.name : null,
    mainKeyword: null,
    countyKeyword: null,
    fingerprint: c.id,
    facts: c.facts,
  };
}

async function loadSite(websiteId: string) {
  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) throw new Error("Không tìm thấy website.");
  return website;
}

/**
 * Writes ONE article: generate, check, rewrite up to the cap, store.
 *
 * The row is created BEFORE generation so the spend ledger has an articleId to
 * attach to from the first call. A row created afterwards would leave the first
 * attempt's cost unattributable — and the first attempt is the one that always
 * happens, including for articles that end up failing.
 */
async function writeOne(
  websiteId: string,
  candidate: ArticleCandidate,
  ctxBase: Awaited<ReturnType<typeof buildQcContext>>
): Promise<{ ok: boolean; title: string; detail: string }> {
  const existing = await prisma.article.findUnique({
    where: { websiteId_candidateId: { websiteId, candidateId: candidate.id } },
  });
  if (existing) return { ok: true, title: existing.title, detail: "đã có, bỏ qua" };

  const row = await prisma.article.create({
    data: {
      websiteId,
      candidateId: candidate.id,
      vertical: candidate.vertical,
      intent: candidate.intent,
      angle: candidate.angle,
      title: candidate.title,
      content: "",
      qcReport: { passed: false, checks: [] },
      status: "writing",
    },
  });

  try {
    const result = await writeArticle({
      candidate,
      ctx: { ...ctxBase, factSet: factSetFor(candidate) },
      websiteId,
      articleId: row.id,
    });

    await prisma.article.update({
      where: { id: row.id },
      data: {
        title: result.draft.title,
        content: result.draft.html,
        attempts: result.attempts,
        costUsd: result.costUsd,
        qcReport: JSON.parse(JSON.stringify(result.report)),
        status: result.report.passed ? "draft" : "failed",
      },
    });

    return {
      ok: result.report.passed,
      title: result.draft.title,
      detail: result.report.passed
        ? `đạt sau ${result.attempts} lần, $${result.costUsd.toFixed(4)}`
        : `trượt sau ${result.attempts} lần: ${result.report.checks.filter((c) => !c.passed).map((c) => c.id).join(", ")}`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "lỗi không rõ";
    await prisma.article.update({
      where: { id: row.id },
      data: { status: "failed", qcReport: { passed: false, checks: [{ id: "error", label: "Lỗi", passed: false, detail }] } },
    });
    return { ok: false, title: candidate.title, detail };
  }
}

export async function writeOneArticleAction(
  _prev: ArticleActionResult,
  formData: FormData
): Promise<ArticleActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const candidateId = String(formData.get("candidateId") ?? "");

  try {
    const website = await loadSite(websiteId);
    const candidates = await discoverCandidates(website.vertical);
    const candidate = candidates.find((c) => c.id === candidateId);
    if (!candidate) return { ok: false, message: "Ứng viên không còn trong danh sách — dữ liệu có thể đã đổi." };

    const ctx = await buildQcContext(websiteId, website.vertical, website.url);
    const r = await writeOne(websiteId, candidate, ctx);
    revalidatePath(`/publisher/${websiteId}/articles`);
    return { ok: r.ok, message: `${r.title} — ${r.detail}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Thất bại." };
  }
}

/**
 * Starts a batch and returns immediately.
 *
 * The loop runs detached, writing progress to ArticleJob as it goes, and the
 * page polls that row. A server action that awaited the whole batch would hold
 * an HTTP request open for minutes and die at the first proxy timeout, taking
 * the progress with it.
 *
 * The honest limit: this runs in the Next process, so a deploy mid-batch kills
 * it. The job then sits at "running" with a stale updatedAt — visible as a
 * stuck bar rather than as silence, and resumable by starting again, since
 * writeOne skips candidates that already have a row.
 */
export async function startArticleBatchAction(
  _prev: ArticleActionResult,
  formData: FormData
): Promise<ArticleActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const intent = String(formData.get("intent") ?? "move-underway") as Intent;
  const limit = Math.max(1, Math.min(50, Number(formData.get("limit") ?? 10)));

  try {
    const website = await loadSite(websiteId);

    const running = await prisma.articleJob.findFirst({ where: { websiteId, status: "running" } });
    if (running) return { ok: false, message: "Đang có một lượt chạy chưa xong. Đợi nó kết thúc hoặc dừng nó trước." };

    const all = await discoverCandidates(website.vertical);
    const done = await prisma.article.findMany({ where: { websiteId }, select: { candidateId: true } });
    const doneIds = new Set(done.map((d) => d.candidateId));
    const queue = all.filter((c) => c.intent === intent && !doneIds.has(c.id)).slice(0, limit);

    if (queue.length === 0) return { ok: false, message: `Không còn ứng viên "${intent}" nào chưa viết.` };

    const job = await prisma.articleJob.create({
      data: { websiteId, intent, total: queue.length, status: "running" },
    });

    void (async () => {
      try {
        const ctx = await buildQcContext(websiteId, website.vertical, website.url);
        for (const candidate of queue) {
          const fresh = await prisma.articleJob.findUnique({ where: { id: job.id } });
          if (fresh?.status !== "running") return; // dừng bởi người dùng
          await prisma.articleJob.update({ where: { id: job.id }, data: { currentTitle: candidate.title } });

          const r = await writeOne(websiteId, candidate, ctx);
          await prisma.articleJob.update({
            where: { id: job.id },
            data: r.ok ? { done: { increment: 1 } } : { done: { increment: 1 }, failed: { increment: 1 } },
          });
        }
        await prisma.articleJob.update({ where: { id: job.id }, data: { status: "done", currentTitle: null } });
      } catch (err) {
        await prisma.articleJob.update({
          where: { id: job.id },
          data: { status: "stopped", error: err instanceof Error ? err.message : "lỗi không rõ" },
        });
      }
    })();

    return { ok: true, message: `Đã bắt đầu viết ${queue.length} bài. Thanh tiến trình cập nhật bên dưới.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Thất bại." };
  }
}

export async function stopArticleBatchAction(
  _prev: ArticleActionResult,
  formData: FormData
): Promise<ArticleActionResult> {
  const jobId = String(formData.get("jobId") ?? "");
  await prisma.articleJob.update({ where: { id: jobId }, data: { status: "stopped" } });
  revalidatePath(`/publisher`);
  return { ok: true, message: "Đã yêu cầu dừng. Bài đang viết dở sẽ hoàn tất rồi mới dừng." };
}

/** Pushes a passed article into WordPress as a DRAFT. */
export async function publishArticleAction(
  _prev: ArticleActionResult,
  formData: FormData
): Promise<ArticleActionResult> {
  const articleId = String(formData.get("articleId") ?? "");
  try {
    const article = await prisma.article.findUnique({ where: { id: articleId }, include: { website: true } });
    if (!article) return { ok: false, message: "Không tìm thấy bài." };
    if (article.status !== "draft") {
      return { ok: false, message: "Chỉ đẩy được bài đã qua toàn bộ checklist." };
    }
    const w = article.website;
    if (!w.wpUsername || !w.wpAppPassword) {
      return { ok: false, message: "Website chưa lưu Application Password nên chưa ghi được vào WordPress." };
    }
    const creds: WpCredentials = {
      username: w.wpUsername,
      applicationPassword: w.wpAppPassword,
      loopbackSecret: w.wpLoopbackSecret,
    };
    const post = await createPost(w.wpApiBaseUrl ?? deriveWpApiBaseUrl(w.url), creds, {
      title: article.title,
      content: article.content,
      status: "draft",
    });
    await prisma.article.update({ where: { id: articleId }, data: { wpPostId: post.id } });
    revalidatePath(`/publisher/${w.id}/articles`);
    return { ok: true, message: `Đã tạo bản nháp trong WordPress (id ${post.id}).` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Thất bại." };
  }
}
