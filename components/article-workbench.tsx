"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Square, Send, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  writeOneArticleAction,
  startArticleBatchAction,
  stopArticleBatchAction,
  publishArticleAction,
  type ArticleActionResult,
} from "@/app/publisher/[websiteId]/articles/actions";

const EMPTY: ArticleActionResult = { ok: false, message: "" };

export interface CandidateRow {
  id: string;
  title: string;
  why: string;
  intent: string;
  angle: string;
  factCount: number;
  written: boolean;
}

export interface ArticleRow {
  id: string;
  title: string;
  status: string;
  attempts: number;
  costUsd: number;
  wpPostId: number | null;
  qcReport: { passed: boolean; checks: { id: string; label: string; passed: boolean; detail: string }[] };
}

export interface JobRow {
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  currentTitle: string | null;
  error: string | null;
}

const INTENTS = [
  { id: "move-underway", label: "Đang chuyển nhà", hint: "ý định thương mại cao nhất — số liệu đo chính việc chuyển nhà" },
  { id: "choosing-place", label: "Đang chọn nơi ở", hint: "giá nhà, thu nhập, tỷ lệ sở hữu" },
  { id: "market-context", label: "Bối cảnh thị trường", hint: "nền, ý định thấp nhất" },
];

function Result({ state }: { state: ArticleActionResult }) {
  if (!state.message) return null;
  return <p className={`text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.message}</p>;
}

/**
 * Live progress for a running batch.
 *
 * Polls rather than streams, and stops polling the moment the job is not
 * running — a bar that keeps requesting after the work is done is a bar that
 * quietly costs something forever.
 *
 * `updatedAt` is not shown as "still working": a job whose process died leaves
 * status "running" with the counter frozen, so the honest reading of a stalled
 * bar is "nothing is moving", which is what it looks like.
 */
function Progress({ job }: { job: JobRow }) {
  const router = useRouter();
  const [stopState, stopAction, stopping] = useActionState(stopArticleBatchAction, EMPTY);

  useEffect(() => {
    if (job.status !== "running") return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [job.status, router]);

  const pct = job.total === 0 ? 0 : Math.round((job.done / job.total) * 100);

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {job.status === "running" ? "Đang viết" : job.status === "done" ? "Đã xong" : "Đã dừng"} — {job.done}/{job.total}
          {job.failed > 0 && <span className="text-red-700"> · {job.failed} trượt</span>}
        </span>
        {job.status === "running" && (
          <form action={stopAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <Button type="submit" size="sm" variant="ghost" disabled={stopping}>
              <Square className="h-3.5 w-3.5" /> Dừng
            </Button>
          </form>
        )}
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${job.failed > 0 ? "bg-amber-500" : "bg-emerald-600"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {job.currentTitle && <p className="truncate text-xs text-muted-foreground">Đang viết: {job.currentTitle}</p>}
      {job.error && <p className="text-xs text-red-700">{job.error}</p>}
      <Result state={stopState} />
    </div>
  );
}

function QcChecks({ report }: { report: ArticleRow["qcReport"] }) {
  const checks = report?.checks ?? [];
  if (checks.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 pt-1">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-1.5 text-xs">
          {c.passed ? (
            <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
          ) : (
            <X className="mt-0.5 h-3 w-3 shrink-0 text-red-600" />
          )}
          <span className={c.passed ? "text-muted-foreground" : "text-red-700"}>
            {c.label}
            {!c.passed && <span className="block">{c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ArticleWorkbench({
  websiteId,
  candidates,
  articles,
  job,
  totalSpendUsd,
}: {
  websiteId: string;
  candidates: CandidateRow[];
  articles: ArticleRow[];
  job: JobRow | null;
  totalSpendUsd: number;
}) {
  const [intent, setIntent] = useState("move-underway");
  const [oneState, oneAction, writingOne] = useActionState(writeOneArticleAction, EMPTY);
  const [batchState, batchAction, startingBatch] = useActionState(startArticleBatchAction, EMPTY);
  const [pubState, pubAction, publishing] = useActionState(publishArticleAction, EMPTY);

  const shown = candidates.filter((c) => c.intent === intent);
  const pending = shown.filter((c) => !c.written);
  const articleCost = articles.reduce((s, a) => s + a.costUsd, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Ý định chọn TRƯỚC, không phải lọc sau. Cùng một dataset phục vụ ba
          người đọc khác nhau, và lô ứng viên đầu tiên phục vụ nhầm người vì
          câu hỏi này không được hỏi. */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium">Ý định người đọc</span>
        <div className="flex flex-wrap gap-2">
          {INTENTS.map((i) => {
            const n = candidates.filter((c) => c.intent === i.id && !c.written).length;
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => setIntent(i.id)}
                title={i.hint}
                className={`rounded-md border px-3 py-1.5 text-left text-sm ${
                  intent === i.id ? "border-foreground bg-muted" : "hover:bg-muted/50"
                }`}
              >
                {i.label} <span className="text-muted-foreground">({n})</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{INTENTS.find((i) => i.id === intent)?.hint}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
        <span>
          Chi phí đã tiêu cho publisher này: <span className="font-medium">${totalSpendUsd.toFixed(4)}</span>
        </span>
        <span className="text-muted-foreground">
          ({articles.length} bài, ${articleCost.toFixed(4)} tính theo bài
          {articles.length > 0 && ` — trung bình $${(articleCost / articles.length).toFixed(4)}/bài`})
        </span>
      </div>

      {job && <Progress job={job} />}

      <form action={batchAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="websiteId" value={websiteId} />
        <input type="hidden" name="intent" value={intent} />
        <label className="text-sm">
          Số bài:
          <input
            name="limit"
            type="number"
            min={1}
            max={50}
            defaultValue={Math.min(10, Math.max(1, pending.length))}
            className="ml-2 w-20 rounded-md border px-2 py-1 text-sm"
          />
        </label>
        <Button type="submit" size="sm" disabled={startingBatch || pending.length === 0}>
          <Play className="h-3.5 w-3.5" /> Tạo hàng loạt (nền)
        </Button>
        <Result state={batchState} />
      </form>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium">{pending.length} ứng viên chưa viết</span>
        {pending.slice(0, 30).map((c) => (
          <div key={c.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{c.title}</div>
              <div className="text-xs text-muted-foreground">{c.why}</div>
              <div className="pt-1 text-xs text-muted-foreground">
                {c.angle} · {c.factCount} fact được phép dùng
              </div>
            </div>
            <form action={oneAction}>
              <input type="hidden" name="websiteId" value={websiteId} />
              <input type="hidden" name="candidateId" value={c.id} />
              <Button type="submit" size="sm" variant="secondary" disabled={writingOne}>
                Viết bài này
              </Button>
            </form>
          </div>
        ))}
        {pending.length > 30 && (
          <p className="text-xs text-muted-foreground">… và {pending.length - 30} ứng viên nữa.</p>
        )}
        <Result state={oneState} />
      </div>

      {articles.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">Đã viết ({articles.length})</span>
          {articles.map((a) => (
            <div key={a.id} className="flex flex-col gap-1 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant={a.status === "draft" ? "default" : a.status === "failed" ? "destructive" : "outline"}>
                    {a.status === "draft" ? "đạt" : a.status === "failed" ? "trượt" : a.status}
                  </Badge>
                  <span className="truncate text-sm font-medium">{a.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {a.attempts} lần · ${a.costUsd.toFixed(4)}
                  </span>
                  {a.status === "draft" &&
                    (a.wpPostId ? (
                      <span className="text-xs text-emerald-700">đã vào WordPress (#{a.wpPostId})</span>
                    ) : (
                      <form action={pubAction}>
                        <input type="hidden" name="articleId" value={a.id} />
                        <Button type="submit" size="sm" variant="secondary" disabled={publishing}>
                          <Send className="h-3.5 w-3.5" /> Đẩy sang WordPress (nháp)
                        </Button>
                      </form>
                    ))}
                </div>
              </div>
              {/* Checklist hiện CẢ mục đạt lẫn mục trượt: một bài "đạt" mà
                  không cho thấy nó đạt cái gì thì không phân biệt được với một
                  bài chưa ai kiểm. */}
              <QcChecks report={a.qcReport} />
            </div>
          ))}
          <Result state={pubState} />
        </div>
      )}
    </div>
  );
}
