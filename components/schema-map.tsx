import type { SchemaNode, SchemaEdge } from "@/lib/publisher/schema-graph";

/**
 * Bản đồ liên kết schema, vẽ bằng SVG dựng sẵn trên máy chủ.
 *
 * Bảng nói được "có những gì"; nó KHÔNG nói được "nối vào đâu". Với một đồ
 * thị, hình dạng CHÍNH LÀ nội dung: một node treo lơ lửng nhìn ra ngay, còn
 * đọc hai mươi dòng bảng rồi tự ghép trong đầu thì không ai làm.
 *
 * Không thư viện, không JS phía trình duyệt: SVG tĩnh, dựng lúc render. Đồ
 * thị này có 9–16 node và dưới 12 cạnh — một bộ layout lực đẩy cho chừng đó
 * node là thêm 100 KB để giải một bài toán không tồn tại.
 *
 * BA TẦNG, theo PHẠM VI của @id chứ không theo loại:
 *
 *   tầng 0  node cấp SITE     @id là `<site>/#...`  — Organization, WebSite
 *   tầng 1  WebPage           trang hiện tại
 *   tầng 2  phần CỦA trang    breadcrumb, dataset, faq
 *
 * Xếp theo phạm vi vì đó là thứ quyết định node nào dùng lại được: node cấp
 * site xuất hiện y hệt trên mọi trang, node cấp trang thì mỗi trang một cái.
 * Xếp theo loại sẽ trộn hai thứ đó vào nhau.
 */

const W = 920;
const ROW_H = 132;
const BOX_H = 42;
const BOX_W = 168;

function layerOf(node: SchemaNode): 0 | 1 | 2 {
  if (node.type === "WebPage") return 1;
  // @id cấp site không có đường dẫn trước dấu #: `https://x.com/#organization`.
  const id = node.id ?? "";
  const hash = id.indexOf("#");
  if (hash < 0) return 2;
  const before = id.slice(0, hash);
  try {
    return new URL(before).pathname.replace(/\/+$/, "") === "" ? 0 : 2;
  } catch {
    return 2;
  }
}

export function SchemaMap({ nodes, edges }: { nodes: SchemaNode[]; edges: SchemaEdge[] }) {
  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">Không có node nào để vẽ.</p>;
  }

  // Gộp theo LOẠI: bản đồ nói về hình dạng của khuôn, không phải về từng
  // trang. Ba mươi WebPage của ba mươi trang là một hộp WebPage.
  const byType = new Map<string, SchemaNode>();
  for (const n of nodes) if (!byType.has(n.type)) byType.set(n.type, n);
  const unique = [...byType.values()];

  const layers: SchemaNode[][] = [[], [], []];
  for (const n of unique) layers[layerOf(n)].push(n);

  const pos = new Map<string, { x: number; y: number }>();
  layers.forEach((row, li) => {
    const gap = W / (row.length + 1);
    row.forEach((n, i) => {
      pos.set(n.type, { x: gap * (i + 1), y: 46 + li * ROW_H });
    });
  });

  const H = 46 + (layers.length - 1) * ROW_H + BOX_H + 30;

  // Cạnh gộp theo (loại nguồn → loại đích) để hai cạnh cùng cặp không vẽ chồng.
  const drawn = new Map<string, { from: string; to: string | null; labels: string[]; resolved: boolean }>();
  for (const e of edges) {
    const key = `${e.fromType}->${e.toType ?? "?"}`;
    const prev = drawn.get(key);
    if (prev) {
      if (!prev.labels.includes(e.property)) prev.labels.push(e.property);
      prev.resolved = prev.resolved && e.resolved;
    } else {
      drawn.set(key, { from: e.fromType, to: e.toType, labels: [e.property], resolved: e.resolved });
    }
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[720px]" role="img" aria-label="Bản đồ liên kết schema">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-(--color-ink-faint)" />
          </marker>
          <marker id="arrow-broken" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-destructive" />
          </marker>
        </defs>

        {["cấp site — dùng lại trên mọi trang", "trang", "phần của trang"].map((label, i) =>
          layers[i].length === 0 ? null : (
            <text key={label} x={8} y={46 + i * ROW_H - 12} className="fill-(--color-ink-faint) text-[11px]">
              {label}
            </text>
          )
        )}

        {[...drawn.values()].map((d) => {
          const a = pos.get(d.from);
          const b = d.to ? pos.get(d.to) : null;
          if (!a) return null;
          // Cạnh đứt: vẽ ĐI RA NGOÀI chứ không bỏ qua. Một liên kết được khai
          // mà không giao được phải nhìn thấy, không phải biến mất.
          const end = b ?? { x: a.x, y: a.y + ROW_H - 18 };
          /**
           * Điểm neo theo HƯỚNG, không cố định đáy→đỉnh.
           *
           * Sáu cạnh của đồ thị này không cùng chiều: `WebPage → WebSite` và
           * `Dataset → Organization` đi NGƯỢC LÊN. Nối đáy nguồn tới đỉnh
           * đích cho mọi cạnh thì hai đường đó xuyên thẳng qua hộp của chính
           * nguồn — bản đồ vẽ sai đúng chỗ nó sinh ra để làm rõ.
           */
          const up = b !== null && end.y < a.y;
          const x1 = a.x;
          const y1 = up ? a.y : a.y + BOX_H;
          const x2 = end.x;
          const y2 = b ? (up ? end.y + BOX_H : end.y) : end.y;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          return (
            <g key={`${d.from}-${d.to}`}>
              <path
                d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray={b ? undefined : "4 3"}
                className={b ? "stroke-(--color-border-subtle)" : "stroke-current text-destructive"}
                markerEnd={b ? "url(#arrow)" : "url(#arrow-broken)"}
              />
              <text x={mx} y={my - 4} textAnchor="middle" className="fill-(--color-ink-faint) text-[10px]">
                {d.labels.join(" · ")}
                {b ? "" : " → không giao được"}
              </text>
            </g>
          );
        })}

        {unique.map((n) => {
          const p = pos.get(n.type);
          if (!p) return null;
          const island = n.id === null;
          return (
            <g key={n.type}>
              <rect
                x={p.x - BOX_W / 2}
                y={p.y}
                width={BOX_W}
                height={BOX_H}
                rx={8}
                className={
                  island
                    ? "fill-transparent stroke-current text-destructive"
                    : "fill-(--color-surface) stroke-(--color-border-subtle)"
                }
                strokeWidth={1.5}
                strokeDasharray={island ? "4 3" : undefined}
              />
              <text x={p.x} y={p.y + 18} textAnchor="middle" className="fill-current text-[12px] font-medium">
                {n.type}
              </text>
              <text x={p.x} y={p.y + 32} textAnchor="middle" className="fill-(--color-ink-faint) text-[10px]">
                {island ? "không có @id — hòn đảo" : `${n.seenOn.length} khuôn`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
