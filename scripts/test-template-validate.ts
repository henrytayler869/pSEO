// Chứng minh mọi lý do từ chối đều có thể kêu.
//
// Ca xấu viết TRƯỚC ca tốt, như scripts/test-article-qc.ts: viết ca đạt trước
// là cách một phép kiểm không bao giờ chạy vẫn cho bộ test màu xanh.
//
// Dùng: tsx scripts/test-template-validate.ts

import { validateTemplate } from "../lib/article-template/validate";
import { DEFAULT_TEMPLATES } from "../lib/article-template/defaults";
import type { ArticleTemplateShape, Block } from "../lib/article-template/render";

function base(): ArticleTemplateShape {
  return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES["commercial"]));
}

const CASES: { name: string; expect: RegExp | null; make: () => ArticleTemplateShape }[] = [
  {
    name: "script trong CTA -> chặn",
    expect: /chạy hoặc nhúng/,
    make: () => {
      const t = base();
      t.blocks.push({ type: "cta", heading: "Hỏi giá", html: '<p>Gọi ngay</p><script src="//widget.example/x.js"></script>' });
      return t;
    },
  },
  {
    name: "onclick trong CTA -> chặn",
    expect: /sự kiện/,
    make: () => {
      const t = base();
      t.blocks.push({ type: "cta", html: '<p onclick="steal()">Gọi ngay</p>' });
      return t;
    },
  },
  {
    name: "javascript: trong href -> chặn",
    expect: /javascript:/,
    make: () => {
      const t = base();
      t.blocks.push({ type: "cta", html: '<a href="javascript:void(0)">Gọi</a>' });
      return t;
    },
  },
  {
    name: "thẻ lạ trong CTA -> chặn",
    expect: /danh sách cho phép/,
    make: () => {
      const t = base();
      t.blocks.push({ type: "cta", html: "<marquee>Gọi ngay</marquee>" });
      return t;
    },
  },
  {
    name: "CTA lành -> KHÔNG chặn",
    expect: null,
    make: () => {
      const t = base();
      t.blocks.push({ type: "cta", heading: "Hỏi giá", html: '<p>Gọi <a href="/lien-he">trang liên hệ</a>.</p>' });
      return t;
    },
  },
  {
    name: "biến gõ sai trong tiêu đề -> chặn",
    expect: /Biến không tồn tại[\s\S]*scopename/i,
    make: () => {
      const t = base();
      t.titlePattern = "Chuyển tới {scopename}";
      return t;
    },
  },
  {
    name: "biến gõ sai trong khối -> chặn",
    expect: /Biến không tồn tại/,
    make: () => {
      const t = base();
      const p = t.blocks.find((b) => b.type === "paragraph") as Extract<Block, { type: "paragraph" }>;
      p.text = "Số liệu của {vungmien}.";
      return t;
    },
  },
  {
    name: "hai khối ai-interpretation -> chặn",
    expect: /ĐÚNG MỘT/,
    make: () => {
      const t = base();
      t.blocks.push({ type: "ai-interpretation" });
      return t;
    },
  },
  {
    name: "bỏ khối ai-interpretation -> chặn",
    expect: /ĐÚNG MỘT/,
    make: () => {
      const t = base();
      t.blocks = t.blocks.filter((b) => b.type !== "ai-interpretation");
      return t;
    },
  },
  {
    name: "bỏ data-table -> chặn",
    expect: /data-table/,
    make: () => {
      const t = base();
      t.blocks = t.blocks.filter((b) => b.type !== "data-table");
      return t;
    },
  },
  {
    name: "bỏ source-note -> chặn",
    expect: /source-note/,
    make: () => {
      const t = base();
      t.blocks = t.blocks.filter((b) => b.type !== "source-note");
      return t;
    },
  },
  {
    name: "tiêu đề rỗng -> chặn",
    expect: /trống/,
    make: () => {
      const t = base();
      t.titlePattern = "   ";
      return t;
    },
  },
  {
    name: "link nội bộ không bắt đầu bằng / -> chặn",
    expect: /bắt đầu bằng/,
    make: () => {
      const t = base();
      const l = t.blocks.find((b) => b.type === "internal-links") as Extract<Block, { type: "internal-links" }>;
      l.paths = ["https://example.com/x"];
      return t;
    },
  },
  {
    name: "cả ba template mặc định -> KHÔNG chặn",
    expect: null,
    make: () => base(),
  },
];

let ok = 0;
const failures: string[] = [];

for (const c of CASES) {
  const problems = validateTemplate(c.make());
  const joined = problems.map((p) => `${p.where}: ${p.message}`).join(" | ");
  const good = c.expect === null ? problems.length === 0 : c.expect.test(joined);
  if (good) ok++;
  else failures.push(`${c.name}\n      nhận: ${joined || "(không vấn đề nào)"}`);
  console.log(`${good ? "✓" : "✗"} ${c.name}`);
}

// Ba bản mặc định phải lưu được. Một bản mặc định mà chính bộ kiểm từ chối là
// bộ kiểm sai, không phải bản mặc định sai — và đúng lỗi này đã xảy ra một lần
// với min-words.
for (const [intent, t] of Object.entries(DEFAULT_TEMPLATES)) {
  const problems = validateTemplate(t);
  const good = problems.length === 0;
  if (good) ok++;
  else failures.push(`mặc định "${intent}" bị chính bộ kiểm từ chối: ${problems.map((p) => p.message).join(" | ")}`);
  console.log(`${good ? "✓" : "✗"} template mặc định "${intent}" lưu được`);
}

console.log(`\n${ok}/${CASES.length + Object.keys(DEFAULT_TEMPLATES).length} kiểm tra đúng.`);
if (failures.length > 0) {
  console.error(`\nTHẤT BẠI:\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
}
