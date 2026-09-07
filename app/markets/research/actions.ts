"use server";

import { revalidatePath } from "next/cache";
import { defineNicheAcrossLocations, normalizeVertical } from "@/lib/markets/define-niche";
import { getSuggestedNiches } from "@/lib/markets/candidate-niches";
import { fetchKeywordMetricsForVertical } from "@/lib/keywords/import";
import { fetchAndStoreRelatedKeywords } from "@/lib/keywords/related-keywords";
import { computeTrafficScoresForVertical } from "@/lib/scoring/market-score";

export interface ActionResult {
  ok: boolean;
  message: string;
  vertical?: string;
}

/** One click, full pipeline: define the niche across every real zip on
 * file, fetch keyword data for it (DataForSEO), then score purely on
 * traffic potential. No manual per-step buttons — this is exactly the
 * "let the Pipeline handle it" flow requested instead of a manual-import
 * page. */
export async function runNicheResearchAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const rawVertical = String(formData.get("vertical") ?? "").trim();
  if (!rawVertical) return { ok: false, message: "Vui lòng nhập tên niche." };
  const vertical = normalizeVertical(rawVertical);
  if (!vertical) return { ok: false, message: "Tên niche không hợp lệ sau khi chuẩn hóa." };

  try {
    const defineResult = await defineNicheAcrossLocations(vertical);
    const keywordResult = await fetchKeywordMetricsForVertical(vertical);
    const scoreResult = await computeTrafficScoresForVertical(vertical);

    // Related-keyword data is on-page SEO input for a content writer, not a
    // scoring input — a failure here (e.g. DataForSEO down) shouldn't sink
    // the whole research run, since the niche is still fully usable for
    // comparison/scoring without it.
    let semanticNote = "";
    try {
      const semanticResult = await fetchAndStoreRelatedKeywords(vertical);
      semanticNote = ` · ${semanticResult.count} từ khóa liên quan (semantic).`;
    } catch (err) {
      semanticNote = ` · Lấy từ khóa liên quan thất bại: ${err instanceof Error ? err.message : "lỗi không rõ"}.`;
    }

    revalidatePath("/markets");
    revalidatePath(`/markets/research/${vertical}`);

    return {
      ok: true,
      vertical,
      message:
        `Niche "${vertical}": tạo ${defineResult.created} thị trường mới (${defineResult.alreadyExisted} đã có sẵn) ` +
        `trên ${defineResult.locationCount} zip thật · lấy ${keywordResult.count} dòng từ khóa qua ${keywordResult.sourceName} ` +
        `(${keywordResult.marketsMissingData} thị trường thiếu dữ liệu) · tính điểm cho ${scoreResult.length} thị trường${semanticNote}`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Nghiên cứu niche thất bại." };
  }
}

/** Same per-niche pipeline as runNicheResearchAction, just looped over
 * every currently-suggested niche in one click instead of one button each.
 * Best-effort: one niche failing (e.g. missing DataForSEO credentials)
 * doesn't stop the rest from being attempted — everything here is already
 * idempotent/resumable per niche, so a partial run costs nothing to retry
 * later. Each niche still does one DataForSEO request per real zip on
 * file, so running this against a large suggestion list has a real cost
 * once DataForSEO is actually configured — same as clicking every
 * individual button, just faster to trigger. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState requires this exact (prevState, formData) signature; this action takes no input.
export async function runAllSuggestedNichesAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  const suggestions = await getSuggestedNiches();
  if (suggestions.length === 0) {
    return { ok: false, message: "Không còn niche nào trong danh sách gợi ý để chạy." };
  }

  let totalCreated = 0;
  let totalKeywords = 0;
  let totalScored = 0;
  let totalSemantic = 0;
  const failures: { vertical: string; message: string }[] = [];

  for (const candidate of suggestions) {
    try {
      const defineResult = await defineNicheAcrossLocations(candidate.vertical);
      const keywordResult = await fetchKeywordMetricsForVertical(candidate.vertical);
      const scoreResult = await computeTrafficScoresForVertical(candidate.vertical);
      totalCreated += defineResult.created;
      totalKeywords += keywordResult.count;
      totalScored += scoreResult.length;
      try {
        const semanticResult = await fetchAndStoreRelatedKeywords(candidate.vertical);
        totalSemantic += semanticResult.count;
      } catch {
        // Same reasoning as runNicheResearchAction: don't sink a niche that
        // otherwise scored fine just because the supplementary
        // related-keyword call failed.
      }
    } catch (err) {
      failures.push({ vertical: candidate.vertical, message: err instanceof Error ? err.message : "lỗi không rõ" });
    }
  }

  revalidatePath("/markets");

  const successCount = suggestions.length - failures.length;
  if (successCount === 0) {
    return {
      ok: false,
      message: `Cả ${suggestions.length} niche đều thất bại — ví dụ "${failures[0].vertical}": ${failures[0].message}`,
    };
  }

  let message =
    `Đã chạy ${successCount}/${suggestions.length} niche: tạo ${totalCreated} thị trường mới, ` +
    `lấy ${totalKeywords} dòng từ khóa, tính điểm cho ${totalScored} thị trường, ${totalSemantic} từ khóa liên quan (semantic).`;
  if (failures.length > 0) {
    message += ` ${failures.length} niche thất bại — ví dụ "${failures[0].vertical}": ${failures[0].message}`;
  }

  return { ok: true, message };
}
