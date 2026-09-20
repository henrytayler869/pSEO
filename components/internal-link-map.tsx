import type { PageGraph, PageKind } from "@/lib/publisher/page-graph";

/**
 * Liên kết nội bộ THẬT giữa các trang — thẻ <a href>, không phải breadcrumb.
 *
 * Hai hình trong tab này trả lời hai câu khác nhau, và gộp chúng lại là mất
 * cả hai:
 *
 *   PageLinkMap       trang này NẰM Ở ĐÂU trong cây (breadcrumb khai tổ tiên)
 *   InternalLinkMap   trang này ĐƯỢC TRỎ TỚI từ đâu, bao nhiêu lần
 *
 * Một trang có breadcrumb hoàn hảo vẫn có thể không trang nào đặt liên kết
 * tới — Google đi theo thẻ <a>, không đi theo JSON-LD.
 *
 * ═══ VÌ SAO ĐIỂM LÀ LOẠI TRANG, KHÔNG PHẢI TỪNG TRANG ═══
 *
 * Đo 20/9/2026 trên atmovingservices.com: 194 trang, 4.442 cạnh nội bộ. Vẽ
 * từng cạnh ra một búi tóc đen kịt — đúng nghĩa "bản đồ" và vô dụng theo
 * nghĩa thực. Gộp theo loại cho 8 điểm và ~30 cạnh, mỗi cạnh mang trọng số
 * THẬT: không cắt bớt, không lấy mẫu, chỉ cộng lại.
 *
 * Thứ cần nhìn từng trang thì vẽ từng trang: trang không ai trỏ tới. Nó ít ỏi
 * (0 trên cả hai site hôm nay) và là lý do người ta mở tab này.
 */

const W = 860;
const H = 420;

/** Vị trí CỐ ĐỊNH theo loại, không phải bố cục tự sinh.
 *
 *  Bố cục lực đẩy sẽ cho hình khác nhau mỗi lần dựng, nên hai lần mở trang
 *  không so được với nhau — và câu hỏi ở đây luôn là "so với lần trước thì
 *  khác gì". Vị trí cố định đọc theo chiều sâu: trang chủ trái, trang lá phải.
 */
const POS: Record<PageKind, { x: number; y: number; label: string }> = {
  home: { x: 70, y: 210, label: "Trang chủ" },
  niche: { x: 215, y: 120, label: "Trang ngành" },
  state: { x: 370, y: 120, label: "Trang bang" },
  cluster: { x: 540, y: 120, label: "Trang cụm" },
  market: { x: 720, y: 210, label: "Trang ZIP" },
  pillar: { x: 540, y: 320, label: "Trang trụ" },
  blog: { x: 370, y: 320, label: "Blog" },
  static: { x: 215, y: 320, label: "Trang tĩnh" },
};

const ORDER: PageKind[] = ["home", "niche", "state", "cluster", "market", "pillar", "blog", "static"];

/** Bán kính theo CĂN BẬC HAI của số trang: mắt đọc diện tích, không đọc bán
 *  kính, nên tỉ lệ thẳng sẽ phóng đại 127 trang ZIP lên gấp nhiều lần sự thật. */
function radiusFor(count: number): number {
  return Math.max(9, Math.min(34, 7 + Math.sqrt(count) * 2.4));
}

/** Độ dày theo log: 1.165 và 6 phải phân biệt được, mà chênh 200 lần thì tỉ lệ
 *  thẳng cho ra một nét mảnh như tóc cạnh một nét dày như thanh xà. */
function widthFor(weight: number): number {
  return Math.max(0.8, Math.min(7, Math.log10(weight + 1) * 2.2));
}

/** Nhãn số chỉ cho cạnh nặng. Ba mươi nhãn chồng lên nhau thì không nhãn nào
 *  đọc được; cạnh nhẹ vẫn có <title> khi rê chuột. */
const LABEL_MIN = 100;

export function InternalLinkMap({ graph }: { graph: PageGraph }) {
  const { links } = graph;
  const present = ORDER.filter((k) => (links.countByKind.get(k) ?? 0) > 0);

  const edges = [...links.byKind.entries()]
    .map(([key, weight]) => {
      const [from, to] = key.split("→") as [PageKind, PageKind];
      return { from, to, weight };
    })
    .filter((e) => POS[e.from] && POS[e.to])
    .sort((a, b) => a.weight - b.weight);

  return (
    <div className="flex flex-col gap-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-foreground" role="img"
        aria-label={`Liên kết nội bộ giữa ${links.edges} cặp trang, gộp theo ${present.length} loại trang`}>
        <defs>
          <marker id="ilm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="currentColor" opacity="0.45" />
          </marker>
        </defs>

        {edges.map((e) => {
          const a = POS[e.from];
          const b = POS[e.to];
          if (e.from === e.to) {
            // Tự trỏ: trang ZIP trỏ sang trang ZIP khác. 1.165 cạnh trong số
            // đó ở site này — bỏ qua thì hình nói sai về thứ dày đặc nhất.
            const r = radiusFor(links.countByKind.get(e.from) ?? 1);
            return (
              <g key={`${e.from}-self`} opacity={0.55}>
                <title>{`${a.label} → ${a.label}: ${e.weight} liên kết`}</title>
                <path
                  d={`M ${a.x - r * 0.6} ${a.y - r * 0.8} a ${r * 0.9} ${r * 0.9} 0 1 1 ${r * 1.2} 0`}
                  fill="none" stroke="currentColor" strokeWidth={widthFor(e.weight)}
                  markerEnd="url(#ilm-arrow)"
                />
                <text x={a.x} y={a.y - r - 16} textAnchor="middle" className="fill-current text-[10px]" opacity={0.7}>
                  ↻ {e.weight}
                </text>
              </g>
            );
          }
          // Cong nhẹ, lệch theo chiều: A→B và B→A không đè lên nhau.
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const off = 16;
          const cx = mx - (dy / len) * off;
          const cy = my + (dx / len) * off;
          return (
            <g key={`${e.from}-${e.to}`} opacity={0.5}>
              <title>{`${a.label} → ${b.label}: ${e.weight} liên kết`}</title>
              <path d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`} fill="none" stroke="currentColor"
                strokeWidth={widthFor(e.weight)} markerEnd="url(#ilm-arrow)" />
              {e.weight >= LABEL_MIN ? (
                <text x={cx} y={cy} textAnchor="middle" dy="-3" className="fill-current text-[10px]" opacity={0.85}>
                  {e.weight}
                </text>
              ) : null}
            </g>
          );
        })}

        {present.map((k) => {
          const p = POS[k];
          const count = links.countByKind.get(k) ?? 0;
          const r = radiusFor(count);
          return (
            <g key={k}>
              <title>{`${p.label}: ${count} trang`}</title>
              <circle cx={p.x} cy={p.y} r={r} fill="currentColor" opacity={0.12} />
              <circle cx={p.x} cy={p.y} r={r} fill="none" stroke="currentColor" strokeWidth={1.5} />
              <text x={p.x} y={p.y + 4} textAnchor="middle" className="fill-current text-[11px] font-semibold">
                {count}
              </text>
              <text x={p.x} y={p.y + r + 14} textAnchor="middle" className="fill-current text-[11px]" opacity={0.75}>
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="text-xs text-muted-foreground">
        Chấm = một LOẠI trang, số trong chấm là số trang loại đó. Đường = liên kết thật giữa hai loại, dày theo số
        lượng (thang log), mũi tên chỉ chiều. Nhãn số hiện cho cạnh từ {LABEL_MIN} liên kết trở lên; cạnh nhẹ hơn
        hiện khi rê chuột. ↻ là liên kết trong cùng một loại — trang ZIP trỏ sang trang ZIP khác.
      </p>
    </div>
  );
}

/** Trang không ai trỏ tới, vẽ từng cái. Đây là thứ cần nhìn theo trang. */
export function UnlinkedPages({ graph }: { graph: PageGraph }) {
  const { unlinked, deadEnds, inbound } = graph.links;
  const values = [...inbound.values()].sort((a, b) => a - b);
  const median = values.length > 0 ? values[Math.floor(values.length / 2)] : 0;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <span>
          <span className="text-muted-foreground">Liên kết vào mỗi trang: </span>
          ít nhất {values[0] ?? 0} · trung vị {median} · nhiều nhất {values[values.length - 1] ?? 0}
        </span>
        <span>
          <span className="text-muted-foreground">Tổng liên kết nội bộ: </span>
          {graph.links.edges}
        </span>
      </div>

      {unlinked.length === 0 ? (
        <p className="text-muted-foreground">
          Không trang nào bị bỏ rơi: mọi trang trong sitemap đều được ít nhất một trang khác đặt liên kết tới.
        </p>
      ) : (
        <div>
          <p className="mb-1 text-destructive">
            {unlinked.length} trang không trang nào đặt liên kết tới. Chúng vẫn nằm trong sitemap và vẫn trả 200, nhưng
            Google đi theo thẻ &lt;a&gt; — một trang chỉ có trong sitemap là một trang phải chờ được chiếu cố.
          </p>
          <ul className="ml-4 list-disc text-destructive">
            {unlinked.map((p) => (
              <li key={p}><code>{p}</code></li>
            ))}
          </ul>
        </div>
      )}

      {deadEnds.length > 0 ? (
        <div>
          <p className="mb-1 text-muted-foreground">
            {deadEnds.length} trang không trỏ đi đâu cả — ngõ cụt cho người đọc lẫn cho bot:
          </p>
          <ul className="ml-4 list-disc text-muted-foreground">
            {deadEnds.map((p) => (
              <li key={p}><code>{p}</code></li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
