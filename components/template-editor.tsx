"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  saveTemplateAction,
  resetTemplateAction,
  type TemplateActionResult,
  type TemplateRow,
} from "@/app/publisher/[websiteId]/templates/actions";
import type { Block, ArticleTemplateShape } from "@/lib/article-template/render";

const EMPTY: TemplateActionResult = { ok: false, message: "" };

const INTENT_LABEL: Record<string, string> = {
  "move-underway": "Đang chuyển nhà",
  "choosing-place": "Đang chọn nơi ở",
  "market-context": "Bối cảnh thị trường",
};

const BLOCK_LABEL: Record<Block["type"], string> = {
  heading: "Tiêu đề mục",
  paragraph: "Đoạn văn",
  "data-table": "Bảng số liệu",
  "ai-interpretation": "Đoạn AI diễn giải",
  "internal-links": "Link nội bộ",
  cta: "Kêu gọi hành động",
  "source-note": "Ghi chú nguồn",
};

/** Khối thêm được. data-table, ai-interpretation và source-note vắng mặt vì
 * template nào cũng buộc phải có đúng một cái — thêm cái thứ hai chỉ để bị bộ
 * kiểm từ chối là mời người ta làm một việc không bao giờ thành. */
const ADDABLE: Block["type"][] = ["heading", "paragraph", "internal-links", "cta"];

function newBlock(type: Block["type"]): Block {
  switch (type) {
    case "heading":
      return { type: "heading", level: 2, text: "Mục mới" };
    case "paragraph":
      return { type: "paragraph", text: "Nội dung đoạn. Dùng {scopeName} để chèn tên khu vực." };
    case "internal-links":
      return { type: "internal-links", heading: "Liên quan", paths: ["/"] };
    case "cta":
      return { type: "cta", heading: "Bước tiếp theo", html: "<p>Liên hệ để nhận báo giá.</p>" };
    default:
      return { type: "paragraph", text: "" };
  }
}

function Field({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <label className="flex-1 text-xs">
      <span className="block text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(4, Math.max(1, Math.ceil(value.length / 70)))}
        className={`mt-0.5 w-full resize-y rounded-md border px-2 py-1 text-sm ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}

function BlockEditor({
  block,
  onChange,
}: {
  block: Block;
  onChange: (b: Block) => void;
}) {
  switch (block.type) {
    case "heading":
      return (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="block text-muted-foreground">Cấp</span>
            <select
              value={block.level}
              onChange={(e) => onChange({ ...block, level: Number(e.target.value) as 2 | 3 })}
              className="mt-0.5 rounded-md border px-2 py-1 text-sm"
            >
              <option value={2}>H2</option>
              <option value={3}>H3</option>
            </select>
          </label>
          <Field label="Chữ" value={block.text} onChange={(v) => onChange({ ...block, text: v })} />
        </div>
      );
    case "paragraph":
      return <Field label="Chữ" value={block.text} onChange={(v) => onChange({ ...block, text: v })} />;
    case "data-table":
      return (
        <Field
          label="Chú thích bảng (tuỳ chọn)"
          value={block.caption ?? ""}
          onChange={(v) => onChange({ ...block, caption: v })}
        />
      );
    case "internal-links":
      return (
        <div className="flex flex-col gap-2">
          <Field label="Tiêu đề mục" value={block.heading ?? ""} onChange={(v) => onChange({ ...block, heading: v })} />
          <Field
            label="Đường dẫn, mỗi dòng một cái. Đường dẫn site không phục vụ sẽ bị BỎ khi dựng bài, không thành link gãy."
            value={block.paths.join("\n")}
            mono
            onChange={(v) => onChange({ ...block, paths: v.split("\n").map((s) => s.trim()).filter(Boolean) })}
          />
        </div>
      );
    case "cta":
      return (
        <div className="flex flex-col gap-2">
          <Field label="Tiêu đề mục" value={block.heading ?? ""} onChange={(v) => onChange({ ...block, heading: v })} />
          <Field label="HTML" value={block.html} mono onChange={(v) => onChange({ ...block, html: v })} />
          <p className="text-xs text-amber-700">
            Đây là khối duy nhất HTML đi thẳng vào bài, không escape — và checklist QC bóc thẻ trước khi soi, nên thứ
            đặt ở đây không mục kiểm nào nhìn thấy. Chỉ nhận thẻ định dạng; script, iframe, form và thuộc tính sự kiện
            bị từ chối lúc lưu.
          </p>
        </div>
      );
    case "ai-interpretation":
      return (
        <p className="text-xs text-muted-foreground">
          Chỗ duy nhất model được viết. Không sửa nội dung ở đây — nội dung sinh ra mỗi bài một khác, đó là lý do khối
          này tồn tại.
        </p>
      );
    case "source-note":
      return (
        <p className="text-xs text-muted-foreground">
          Dựng từ danh sách nguồn đã gắn cho ngành, không gõ tay — đổi tên một nguồn là mọi bài dựng sau đó đổi theo.
        </p>
      );
  }
}

function IntentEditor({ websiteId, row, preview }: { websiteId: string; row: TemplateRow; preview: string | null }) {
  const [shape, setShape] = useState<ArticleTemplateShape>(row.shape);
  const [name, setName] = useState(row.name);
  const [saveState, saveAction, saving] = useActionState(saveTemplateAction, EMPTY);
  const [resetState, resetAction, resetting] = useActionState(resetTemplateAction, EMPTY);
  const [showPreview, setShowPreview] = useState(false);
  const router = useRouter();

  // Nạp lại dữ liệu server sau khi lưu, thay cho revalidatePath trong action —
  // xem ghi chú trong actions.ts. router.refresh() giữ nguyên component, nên
  // câu thông báo và bản nháp đang sửa dở đều còn.
  useEffect(() => {
    if (saveState.ok) router.refresh();
  }, [saveState, router]);
  useEffect(() => {
    if (resetState.ok) router.refresh();
  }, [resetState, router]);

  const setBlock = (i: number, b: Block) =>
    setShape({ ...shape, blocks: shape.blocks.map((x, j) => (j === i ? b : x)) });
  const move = (i: number, d: number) => {
    const next = [...shape.blocks];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setShape({ ...shape, blocks: next });
  };
  const remove = (i: number) => setShape({ ...shape, blocks: shape.blocks.filter((_, j) => j !== i) });
  const add = (t: Block["type"]) => setShape({ ...shape, blocks: [...shape.blocks, newBlock(t)] });

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{INTENT_LABEL[row.intent] ?? row.intent}</span>
          {row.isDefault ? (
            <Badge variant="outline">bản mặc định</Badge>
          ) : (
            <Badge>đã sửa riêng</Badge>
          )}
          {/* Mốc thời gian đọc từ DB, không phải từ giá trị trả về của action.
              Lưu thành công sẽ revalidate và cuốn theo state của action, nên
              câu "đã lưu" biến mất ngay khi nó đúng nhất — còn với template đã
              sửa sẵn thì badge cũng không đổi, và người bấm Lưu không nhận
              được gì. Con số này đổi mỗi lần lưu, và nó nói về thứ thật sự
              nằm trong DB chứ không về thứ action vừa nói. */}
          {row.updatedAt && (
            <span className="text-xs text-muted-foreground">
              lưu lúc {new Date(row.updatedAt).toLocaleString("vi-VN")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "Ẩn xem trước" : "Xem trước"}
          </Button>
          {!row.isDefault && (
            <form action={resetAction}>
              <input type="hidden" name="websiteId" value={websiteId} />
              <input type="hidden" name="intent" value={row.intent} />
              <Button type="submit" size="sm" variant="ghost" disabled={resetting}>
                <RotateCcw className="h-3.5 w-3.5" /> Về mặc định
              </Button>
            </form>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Field label="Mẫu tiêu đề" value={shape.titlePattern} onChange={(v) => setShape({ ...shape, titlePattern: v })} />
        <Field label="Mẫu meta description" value={shape.metaPattern} onChange={(v) => setShape({ ...shape, metaPattern: v })} />
      </div>

      <div className="flex flex-col gap-2">
        {shape.blocks.map((b, i) => {
          const fixed = b.type === "ai-interpretation" || b.type === "data-table" || b.type === "source-note";
          return (
            <div key={i} className="flex flex-col gap-1 rounded-md border bg-muted/20 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">
                  {i + 1}. {BLOCK_LABEL[b.type]}
                  {fixed && <span className="pl-1 font-normal text-muted-foreground">(bắt buộc có, không xoá được)</span>}
                </span>
                <div className="flex items-center gap-0.5">
                  <Button type="button" size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => move(i, 1)}
                    disabled={i === shape.blocks.length - 1}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} disabled={fixed}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <BlockEditor block={b} onChange={(nb) => setBlock(i, nb)} />
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xs text-muted-foreground">Thêm khối:</span>
        {ADDABLE.map((t) => (
          <Button key={t} type="button" size="sm" variant="secondary" onClick={() => add(t)}>
            <Plus className="h-3 w-3" /> {BLOCK_LABEL[t]}
          </Button>
        ))}
      </div>

      <form action={saveAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="websiteId" value={websiteId} />
        <input type="hidden" name="intent" value={row.intent} />
        <input type="hidden" name="shape" value={JSON.stringify(shape)} />
        <label className="text-xs">
          <span className="block text-muted-foreground">Tên template</span>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-0.5 w-64 rounded-md border px-2 py-1 text-sm"
          />
        </label>
        <Button type="submit" size="sm" disabled={saving}>
          Lưu
        </Button>
      </form>

      {/* Mọi lý do từ chối hiện một lượt. Một form chỉ báo lỗi đầu tiên là
          cách người sửa bỏ cuộc và dán bản mặc định về. */}
      {saveState.problems && saveState.problems.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {saveState.problems.map((p, i) => (
            <li key={i} className="text-xs text-red-700">
              <strong>{p.where}</strong> — {p.message}
            </li>
          ))}
        </ul>
      )}
      {saveState.message && (
        <p className={`text-xs ${saveState.ok ? "text-emerald-700" : "text-red-700"}`}>{saveState.message}</p>
      )}
      {resetState.message && (
        <p className={`text-xs ${resetState.ok ? "text-emerald-700" : "text-red-700"}`}>{resetState.message}</p>
      )}

      {showPreview && (
        <div className="flex flex-col gap-1 rounded-md border border-dashed p-3">
          <span className="text-xs font-medium">Xem trước — dựng từ một ứng viên thật, đoạn AI là chỗ giữ chỗ</span>
          {preview ? (
            <div
              className="prose prose-sm max-w-none text-sm [&_caption]:text-xs [&_table]:w-full [&_td]:border [&_td]:px-2 [&_td]:py-0.5"
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Chưa có ứng viên nào cho ý định này, nên không dựng được bản xem trước từ số liệu thật. Xem trước bằng số
              liệu bịa sẽ cho thấy một trang không tồn tại.
            </p>
          )}
          <p className="pt-1 text-xs text-muted-foreground">
            Bản xem trước dựng từ template ĐÃ LƯU, không phải từ thay đổi chưa lưu trên màn hình. Khối link nội bộ
            không hiện ở đây: nó lọc theo sitemap thật của site, mà gọi sitemap thì bản xem trước sẽ chậm. Vắng ở đây
            không có nghĩa là vắng trên bài.
          </p>
        </div>
      )}
    </div>
  );
}

export function TemplateEditor({
  websiteId,
  rows,
  previews,
}: {
  websiteId: string;
  rows: TemplateRow[];
  previews: Record<string, string | null>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Mỗi ý định một template. Bài viết dựng gần như hoàn toàn từ đây — chỉ một khối là do model viết. Đó là thiết kế,
        không phải cách tiết kiệm: thứ không do model sinh ra thì không thể bị model bịa.
      </p>
      {rows.map((r) => (
        <IntentEditor key={r.intent} websiteId={websiteId} row={r} preview={previews[r.intent] ?? null} />
      ))}
    </div>
  );
}
