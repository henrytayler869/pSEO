import type { PageGraph } from "@/lib/publisher/page-graph";

/**
 * Cây liên kết trang, vẽ bằng điểm và đường.
 *
 * VÌ SAO GỘP ANH EM THÀNH MỘT CHẤM CÓ SỐ: site có 194 trang, và 127 trong số
 * đó là lá cùng một cha. Vẽ 194 chấm cho ra một đám mây không đọc được —
 * "bản đồ" theo nghĩa đen mà vô dụng theo nghĩa thực. Cấu trúc nằm ở các nút
 * NHÁNH; lá chỉ cần biết có bao nhiêu.
 *
 * MỒ CÔI KHÔNG BỊ GỘP. Nó là thứ duy nhất người ta mở tab này để tìm, nên nó
 * được vẽ riêng, màu cảnh báo, kèm tên đầy đủ. Gộp nó vào một con số là xoá
 * đúng phần thông tin có giá trị.
 */

const W = 900;
const ROW_H = 96;
const TOP = 40;
const R = 6;

type Row = { path: string; label: string; leaves: number; children: string[] };

export function PageLinkMap({ graph }: { graph: PageGraph }) {
  const { nodes } = graph;

  // Nút NHÁNH = có con. Lá gom về cha.
  const branches: Row[] = [];
  for (const n of nodes.values()) {
    if (n.children.length === 0) continue;
    const leaves = n.children.filter((c) => (nodes.get(c)?.children.length ?? 0) === 0).length;
    branches.push({
      path: n.path,
      label: n.path === "/" ? "/" : n.path,
      leaves,
      children: n.children.filter((c) => (nodes.get(c)?.children.length ?? 0) > 0),
    });
  }
  if (branches.length === 0) {
    return <p className="text-sm text-muted-foreground">Không dựng được cây — không trang nào có breadcrumb.</p>;
  }

  const byDepth = new Map<number, Row[]>();
  for (const b of branches) {
    const d = nodes.get(b.path)?.depth ?? 0;
    byDepth.set(d, [...(byDepth.get(d) ?? []), b]);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);

  const pos = new Map<string, { x: number; y: number }>();
  depths.forEach((d, di) => {
    const row = byDepth.get(d)!.sort((a, b) => a.path.localeCompare(b.path));
    const gap = W / (row.length + 1);
    row.forEach((b, i) => pos.set(b.path, { x: gap * (i + 1), y: TOP + di * ROW_H }));
  });

  const orphanY = TOP + depths.length * ROW_H + 24;
  const H = orphanY + (graph.orphans.length > 0 ? 52 : 0) + 20;

  return (
    <div className="overflow-x-auto text-foreground">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[680px]" role="img" aria-label="Cây liên kết trang">
        <defs>
          <marker id="pl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" fill="currentColor" fillOpacity={0.4} />
          </marker>
        </defs>

        {branches.map((b) => {
          const a = pos.get(b.path);
          if (!a) return null;
          return b.children.map((c) => {
            const p = pos.get(c);
            if (!p) return null;
            return (
              <path
                key={`${b.path}->${c}`}
                d={`M ${a.x} ${a.y} C ${a.x} ${(a.y + p.y) / 2}, ${p.x} ${(a.y + p.y) / 2}, ${p.x} ${p.y}`}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.25}
                strokeWidth={1.5}
                markerEnd="url(#pl-arrow)"
              />
            );
          });
        })}

        {branches.map((b) => {
          const p = pos.get(b.path);
          if (!p) return null;
          return (
            <g key={b.path}>
              <circle cx={p.x} cy={p.y} r={R} fill="currentColor" />
              <text
                x={p.x}
                y={p.y + 20}
                textAnchor="middle"
                fontSize={12}
                fontWeight={500}
                fill="currentColor"
                stroke="var(--background)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {b.label}
              </text>
              {b.leaves > 0 && (
                <text x={p.x} y={p.y + 34} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.5}>
                  + {b.leaves} trang lá
                </text>
              )}
            </g>
          );
        })}

        {graph.orphans.length > 0 && (
          <g className="text-destructive">
            <text x={0} y={orphanY - 10} fill="currentColor" fontSize={11} fontWeight={500}>
              MỒ CÔI — không breadcrumb của trang nào trỏ tới
            </text>
            {graph.orphans.slice(0, 8).map((o, i) => {
              const gap = W / (Math.min(graph.orphans.length, 8) + 1);
              const x = gap * (i + 1);
              return (
                <g key={o}>
                  <circle cx={x} cy={orphanY + 14} r={R} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 3" />
                  <text x={x} y={orphanY + 34} textAnchor="middle" fontSize={11} fill="currentColor">
                    {o}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}
