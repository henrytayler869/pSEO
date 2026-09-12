"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { buildCandidate, discoverCandidates, type ArticleCandidate, type Intent } from "@/lib/article-candidates/discover";
import { fetchSitemapCounts } from "@/lib/sitemap/count";
import { buildQcContext, writeArticle } from "@/lib/article-qc/write-loop";
import { createPost, type WpCredentials } from "@/lib/wordpress/posts";
import { deriveWpApiBaseUrl } from "@/lib/wordpress/rest-api";
import { SpendCapExceededError, getTotalSpendUsd, getAiConfig } from "@/lib/ai/anthropic";
import type { FactSet } from "@/lib/ai/facts";
import type { ArticleTemplateShape } from "@/lib/article-template/render";
import { DEFAULT_TEMPLATES } from "@/lib/article-template/defaults";

export interface ArticleActionResult {
  ok: boolean;
  message: string;
}

/** FactSet cho bộ kiểm chống bịa số. Lấy thẳng danh tính nơi đó từ ứng viên —
 * bản trước để zip rỗng và nhét tên phạm vi vào state, nên mọi phép kiểm dựa
 * vào ZIP đều so với chuỗi rỗng. */
function factSetFor(c: ArticleCandidate): FactSet {
  return {
    vertical: c.vertical,
    zip: c.zip,
    city: c.city,
    state: c.state,
    county: c.county,
    mainKeyword: null,
    countyKeyword: null,
    fingerprint: c.fingerprint,
    facts: c.facts,
  };
}

async function loadSite(websiteId: string) {
  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) throw new Error("Không tìm thấy website.");
  return website;
}

/**
 * This publisher's template for an intent, or the starting default.
 *
 * Falling back rather than failing: a site that has never opened the template
 * editor should still be able to write an article, and the default is a real
 * template rather than a placeholder. The moment someone edits it, the edit is
 * what gets used — nothing has to be "enabled" first.
 */
async function templateFor(websiteId: string, intent: string): Promise<ArticleTemplateShape> {
  const row = await prisma.articleTemplate.findFirst({
    where: { websiteId, intent, isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (row) return row.blocks as unknown as ArticleTemplateShape;
  const fallback = DEFAULT_TEMPLATES[intent];
  if (!fallback) throw new Error(`Chưa có template cho ý định "${intent}", và cũng không có bản mặc định.`);
  return fallback;
}

/** Source names for the note block, read from the sources tagged for this
 * trade — not typed into the template, so renaming a source updates every
 * article built afterwards. */
async function sourceNamesFor(vertical: string): Promise<string[]> {
  const rows = await prisma.dataSource.findMany({
    where: { isActive: true, relevantVerticals: { has: vertical } },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => r.name);
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
  ctxBase: Awaited<ReturnType<typeof buildQcContext>>,
  templates: Map<string, ArticleTemplateShape>,
  sourceNames: string[]
): Promise<{ ok: boolean; title: string; detail: string; capReached?: boolean }> {
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
      // Cột angle vẫn bắt buộc trong schema và giờ chỉ còn một giá trị. Giữ
      // nguyên cột thay vì migrate: nó ghi lại HÌNH DẠNG bài, và những bài
      // viết bằng lớp ứng viên cũ vẫn mang nhãn cũ của chúng — xoá cột là xoá
      // câu trả lời cho "bài này được dựng kiểu gì".
      angle: "location-profile",
      title: candidate.title,
      content: "",
      qcReport: { passed: false, checks: [] },
      status: "writing",
    },
  });

  try {
    const template = templates.get(candidate.intent);
    if (!template) throw new Error(`Chưa nạp template cho ý định "${candidate.intent}".`);

    const result = await writeArticle({
      candidate,
      ctx: { ...ctxBase, factSet: factSetFor(candidate) },
      template,
      sourceNames,
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
    const capReached = err instanceof SpendCapExceededError;
    // Chạm trần thì XOÁ hàng vừa tạo thay vì đánh dấu trượt: hàng đó không
    // mang nội dung nào và không có báo cáo QC nào, nên để lại nó sẽ chiếm
    // chỗ ứng viên và chặn lần chạy sau viết đúng bài đó.
    if (capReached) await prisma.article.delete({ where: { id: row.id } });
    else
      await prisma.article.update({
        where: { id: row.id },
        data: { status: "failed", qcReport: { passed: false, checks: [{ id: "error", label: "Lỗi", passed: false, detail }] } },
      });
    return { ok: false, title: candidate.title, detail, capReached };
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

    // Fact dựng ở ĐÂY, không dựng khi liệt kê: 2.6–5.3 giây một ZIP, và một
    // trang danh sách không được phép trả giá đó cho 218 nơi.
    // Chưa đo ý định thì KHÔNG viết. Đoán một ý định để chọn template là
    // quay lại đúng việc vừa bỏ đi: một nhãn không có nguồn, quyết định nội
    // dung 174 trang.
    if (!candidate.intent) {
      return { ok: false, message: `Chưa đo ý định từ khoá cho ZIP ${candidate.zip} — chạy đo ý định trước, đừng viết theo phỏng đoán.` };
    }
    const full = await buildCandidate(website.vertical, candidate.zip, candidate.intent);
    if (!full) {
      return { ok: false, message: `Không dựng được bộ số liệu cho ZIP ${candidate.zip} — thiếu dữ liệu, không viết bài rỗng.` };
    }

    const [ctx, template, sourceNames] = await Promise.all([
      buildQcContext(websiteId, website.vertical, website.url),
      templateFor(websiteId, candidate.intent),
      sourceNamesFor(website.vertical),
    ]);
    const r = await writeOne(websiteId, full, ctx, new Map([[full.intent, template]]), sourceNames);
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
  const intent = String(formData.get("intent") ?? "") as Intent;
  if (!intent) return { ok: false, message: "Chưa chọn ý định — không chạy lô theo phỏng đoán." };

  // "Tạo tất cả" bỏ trần 50, nhưng KHÔNG bỏ trần ngân sách: lô vẫn dừng khi
  // chạm trần chi tiêu, và phần chưa viết không bị đánh dấu trượt.
  // Ngưỡng volume tối thiểu, cho nút "viết hết nhóm quan trọng". Khác "top N"
  // ở chỗ nó là một BỘ LỌC: 40 thị trường trên ngưỡng thì viết 40, không phải
  // viết đúng 10 rồi dừng giữa nhóm.
  // Một nút gửi một trường: `priority=<ngưỡng>` vừa nói ngưỡng volume vừa
  // nói "chỉ bài đầu của mỗi từ khoá". Gộp vào một trường vì hai trường rời
  // sẽ có tổ hợp vô nghĩa — ngưỡng cao mà vẫn nhận bản sao — và tổ hợp vô
  // nghĩa nào tồn tại được thì sẽ có ngày ai đó gửi đúng nó.
  const priority = Number(formData.get("priority") ?? 0) || 0;
  const minVolume = priority;

  // Chỉ lấy bài ĐẦU TIÊN của mỗi từ khoá. Không có cờ này thì "viết hết nhóm
  // quan trọng" sẽ dựng 48 trang New York tranh nhau đúng một truy vấn — đúng
  // thứ thứ tự trải-rộng-trước sinh ra để tránh, và một nút đi ngược lại nó
  // thì tệ hơn không có nút.
  const firstPerKeyword = priority > 0;

  const wantsAll = formData.get("all") === "1";
  const limit = wantsAll ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.min(50, Number(formData.get("limit") ?? 10)));

  try {
    const website = await loadSite(websiteId);

    const running = await prisma.articleJob.findFirst({ where: { websiteId, status: "running" } });
    if (running) return { ok: false, message: "Đang có một lượt chạy chưa xong. Đợi nó kết thúc hoặc dừng nó trước." };

    // servedPaths phải truyền Ở ĐÂY nữa, không chỉ ở trang danh sách.
    //
    // Thiếu nó, màn hình hiện 174 ứng viên còn lô lấy từ 256 — chênh 82 nơi
    // ĐÃ có trang market, tức đúng những bài mà phần loại trừ sinh ra để
    // tránh. Một danh sách và một hàng đợi đọc hai tập khác nhau là lỗi không
    // ai thấy cho tới khi bài trùng đã lên site.
    const servedPaths = await fetchSitemapCounts(website.url).then(
      (sm) => new Set(sm.urls.map((u) => new URL(u).pathname.replace(/\/+$/, ""))),
      () => new Set<string>()
    );
    const all = await discoverCandidates(website.vertical, { servedPaths });
    const done = await prisma.article.findMany({ where: { websiteId }, select: { candidateId: true } });
    const doneIds = new Set(done.map((d) => d.candidateId));
    const queue = all
      .filter(
        (c) =>
          c.intent === intent &&
          !doneIds.has(c.id) &&
          c.searchVolume >= minVolume &&
          (!firstPerKeyword || c.keywordRank === 1)
      )
      .slice(0, limit);

    if (queue.length === 0) {
      return {
        ok: false,
        message: minVolume > 0
          ? `Không còn ứng viên "${intent}" nào chưa viết có từ khoá từ ${minVolume.toLocaleString("vi-VN")} lượt/tháng trở lên.`
          : `Không còn ứng viên "${intent}" nào chưa viết.`,
      };
    }

    const job = await prisma.articleJob.create({
      data: { websiteId, intent, total: queue.length, status: "running" },
    });

    void (async () => {
      try {
        const [ctx, template, sourceNames] = await Promise.all([
          buildQcContext(websiteId, website.vertical, website.url),
          templateFor(websiteId, intent),
          sourceNamesFor(website.vertical),
        ]);
        const templates = new Map([[intent, template]]);
        for (const candidate of queue) {
          const fresh = await prisma.articleJob.findUnique({ where: { id: job.id } });
          if (fresh?.status !== "running") return; // dừng bởi người dùng
          await prisma.articleJob.update({ where: { id: job.id }, data: { currentTitle: candidate.title } });

          const full = candidate.intent
            ? await buildCandidate(website.vertical, candidate.zip, candidate.intent)
            : null;
          if (!full) {
            // Thiếu dữ liệu cho ZIP này thì BỎ QUA và đếm là trượt, không
            // dừng cả lô: một nơi thiếu số liệu không nói gì về 200 nơi còn
            // lại, và dừng hết vì một nơi là biến một lỗ hổng dữ liệu thành
            // một lô hỏng.
            await prisma.articleJob.update({ where: { id: job.id }, data: { failed: { increment: 1 } } });
            continue;
          }
          const r = await writeOne(websiteId, full, ctx, templates, sourceNames);
          if (r.capReached) {
            // Trần ngân sách DỪNG cả lô, không đánh dấu phần còn lại là
            // "trượt". Hai chuyện khác nhau: một bài trượt QC là bài viết
            // chưa đạt; một bài không được viết vì hết ngân sách thì chưa ai
            // đánh giá nó. Gộp chúng lại sẽ tạo ra một danh sách bài "hỏng"
            // mà thật ra chưa từng được thử.
            await prisma.articleJob.update({
              where: { id: job.id },
              data: { status: "stopped", currentTitle: null, error: r.detail },
            });
            return;
          }
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

/** Ngân sách còn lại, để trang nói trước thay vì để người dùng phát hiện lúc
 * chạm trần. Trần là toàn hệ thống, không phải theo publisher — nên con số này
 * là thứ MỌI publisher chia nhau, và nói rõ điều đó quan trọng hơn con số. */
export async function getBudgetAction(): Promise<{ capUsd: number; spentUsd: number; remainingUsd: number }> {
  const [cfg, spent] = await Promise.all([getAiConfig(), getTotalSpendUsd()]);
  return { capUsd: cfg.spendCapUsd, spentUsd: spent, remainingUsd: Math.max(0, cfg.spendCapUsd - spent) };
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
