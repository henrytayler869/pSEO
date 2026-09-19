import type { SchemaNode, SchemaEdge } from "@/lib/publisher/schema-graph";

/**
 * Bản đồ liên kết schema — điểm và đường, vẽ sẵn trên máy chủ.
 *
 * SƠN BẰNG `currentColor`, KHÔNG BẰNG CLASS TAILWIND.
 *
 * Bản trước dùng `fill-(--color-surface)` và `stroke-(--color-border-subtle)`.
 * Ba biến đó tồn tại ở kho PUBLISHER, không tồn tại ở kho này — tôi bê quy
 * ước từ repo bên kia sang mà không kiểm. Hậu quả trên màn hình: `fill` nhận
 * giá trị rỗng nên trình duyệt vẽ hộp ĐEN ĐẶC, chữ bên trong chìm hẳn, và
 * `stroke` rỗng khiến mọi đường nối BIẾN MẤT — chỉ còn mũi tên trôi giữa
 * không trung, với nhãn thuộc tính không gắn vào gì cả.
 *
 * `currentColor` không phụ thuộc biến nào: nó lấy `color` của phần tử cha,
 * nên đổi theme là đổi theo, và một biến bị đổi tên không làm bản đồ đen sì.
 * Màu cảnh báo đặt bằng class `text-destructive` trên CHÍNH phần tử đó rồi
 * để `stroke="currentColor"` hứng — cùng cơ chế, không thêm phụ thuộc.
 *
 * ĐIỂM thay vì HỘP: hộp 168px buộc phải xếp thưa, và với sáu node thì nửa
 * bản đồ là khoảng trống trong khi nhãn vẫn chen nhau. Một chấm cộng nhãn
 * dưới chân chiếm đúng chỗ của chữ.
 */

const W = 900;
const ROW_H = 150;
const TOP = 54;
const R = 7;

const LAYER_LABELS = ["cấp site — dùng lại trên mọi trang", "trang", "phần của trang"];

function layerOf(node: SchemaNode): 0 | 1 | 2 {
  if (node.type === "WebPage") return 1;
  const id = node.id ?? "";
  const hash = id.indexOf("#");
  if (hash < 0) return 2;
  try {
    return new URL(id.slice(0, hash)).pathname.replace(/\/+$/, "") === "" ? 0 : 2;
  } catch {
    return 2;
  }
}

export function SchemaMap({ nodes, edges }: { nodes: SchemaNode[]; edges: SchemaEdge[] }) {
  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">Không có node nào để vẽ.</p>;
  }

  // Gộp theo LOẠI: bản đồ nói về hình dạng của khuôn, không về từng trang.
  const byType = new Map<string, SchemaNode>();
  for (const n of nodes) if (!byType.has(n.type)) byType.set(n.type, n);
  const unique = [...byType.values()];

  const layers: SchemaNode[][] = [[], [], []];
  for (const n of unique) layers[layerOf(n)].push(n);

  const pos = new Map<string, { x: number; y: number }>();
  layers.forEach((row, li) => {
    const gap = W / (row.length + 1);
    row.forEach((n, i) => pos.set(n.type, { x: gap * (i + 1), y: TOP + li * ROW_H }));
  });

  const H = TOP + (layers.length - 1) * ROW_H + 60;

  const drawn = new Map<string, { from: string; to: string | null; labels: string[] }>();
  for (const e of edges) {
    const key = `${e.fromType}->${e.toType ?? "?"}`;
    const prev = drawn.get(key);
    if (prev) {
      if (!prev.labels.includes(e.property)) prev.labels.push(e.property);
    } else {
      drawn.set(key, { from: e.fromType, to: e.toType, labels: [e.property] });
    }
  }

  return (
    <div className="overflow-x-auto text-foreground">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[680px]" role="img" aria-label="Bản đồ liên kết schema">
        <defs>
          <marker id="sm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" fill="currentColor" fillOpacity={0.45} />
          </marker>
          <marker id="sm-arrow-red" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
          </marker>
        </defs>

        {layers.map((row, i) =>
          row.length === 0 ? null : (
            <g key={LAYER_LABELS[i]}>
              <line
                x1={0}
                x2={W}
                y1={TOP + i * ROW_H - 26}
                y2={TOP + i * ROW_H - 26}
                stroke="currentColor"
                strokeOpacity={0.08}
              />
              <text x={0} y={TOP + i * ROW_H - 32} fill="currentColor" fillOpacity={0.45} fontSize={11}>
                {LAYER_LABELS[i]}
              </text>
            </g>
          )
        )}

        {[...drawn.values()].map((d) => {
          const a = pos.get(d.from);
          const b = d.to ? pos.get(d.to) : null;
          if (!a) return null;
          const broken = !b;
          const end = b ?? { x: a.x, y: a.y + 62 };

          // Cạnh đi LÊN vòng ra ngoài. Nối thẳng thì nó xuyên qua hàng giữa và
          // cắt ngang nhãn ở đó — đo được ở bản trước: "creator" nằm đè lên
          // hộp WebPage.
          const up = b !== null && end.y < a.y;
          const bow = up ? (a.x < W / 2 ? -1 : 1) * 110 : 0;
          const cx1 = a.x + bow;
          const cy1 = (a.y + end.y) / 2;
          const path = `M ${a.x} ${a.y} C ${cx1} ${cy1}, ${end.x + bow} ${cy1}, ${end.x} ${end.y}`;

          // Nhãn đặt ở 1/3 quãng đường tính từ nguồn, lệch ra phía vòng cung:
          // giữa đường là nơi nhiều cạnh cùng đi qua nhất.
          const lx = a.x + (end.x - a.x) * 0.34 + bow * 0.6;
          const ly = a.y + (end.y - a.y) * 0.34;

          return (
            <g key={`${d.from}-${d.to}`} className={broken ? "text-destructive" : undefined}>
              <path
                d={path}
                fill="none"
                stroke="currentColor"
                strokeOpacity={broken ? 1 : 0.28}
                strokeWidth={1.5}
                strokeDasharray={broken ? "5 4" : undefined}
                markerEnd={broken ? "url(#sm-arrow-red)" : "url(#sm-arrow)"}
              />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                fontSize={11}
                fill="currentColor"
                fillOpacity={broken ? 1 : 0.6}
                stroke="var(--background)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {d.labels.join(" · ")}
                {broken ? " ✕" : ""}
              </text>
            </g>
          );
        })}

        {unique.map((n) => {
          const p = pos.get(n.type);
          if (!p) return null;
          const island = n.id === null;
          return (
            <g key={n.type} className={island ? "text-destructive" : undefined}>
              {island && <circle cx={p.x} cy={p.y} r={R + 5} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 3" />}
              <circle cx={p.x} cy={p.y} r={R} fill="currentColor" />
              <text
                x={p.x}
                y={p.y + 26}
                textAnchor="middle"
                fontSize={13}
                fontWeight={500}
                fill="currentColor"
                stroke="var(--background)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {n.type}
              </text>
              <text x={p.x} y={p.y + 41} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={island ? 1 : 0.5}>
                {island ? "không có @id" : `${n.seenOn.length} khuôn`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
