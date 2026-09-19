import { fetchServedInventory } from "@/lib/publisher/inventory";

/**
 * Bản đồ liên kết schema của một site.
 *
 * Câu hỏi nó trả lời KHÔNG phải "trang này có JSON-LD không" — cổng
 * verify-technical-rules đã trả lời câu đó. Câu ở đây là: các node có NỐI
 * ĐƯỢC vào nhau không.
 *
 * Vì sao điều đó đáng đo riêng: một node hợp lệ mà không có `@id` thì không
 * thứ gì tham chiếu tới nó được, và cũng không tham chiếu ra được. Nó là một
 * hòn đảo. Trình đọc schema vẫn nhận, mọi bộ kiểm cú pháp vẫn xanh, và toàn
 * bộ giá trị của việc dựng @graph — nói cho máy biết tổ chức nào xuất bản
 * trang nào, trang nào chứa dữ liệu nào — mất sạch mà không ai thấy.
 *
 * LẤY MẪU THEO KHUÔN, KHÔNG QUÉT HẾT. Đồ thị schema là thuộc tính của KHUÔN
 * trang, không phải của từng trang: 127 trang thị trường sinh ra từ cùng một
 * component nên có cùng hình dạng. Quét cả 158 trang tốn 158 request để trả
 * lời một câu mà 8 request đã trả lời.
 *
 * Và cái giá của việc lấy mẫu được NÓI RA: nếu một khuôn nào đó không có
 * trang nào trong mẫu, màn hình ghi rõ khuôn đó chưa được soi.
 */

export interface SchemaNode {
  type: string;
  id: string | null;
  /** Đường dẫn của các trang chứa node này. */
  seenOn: string[];
}

export interface SchemaEdge {
  fromType: string;
  property: string;
  toId: string;
  /** @id đích có thật sự tồn tại trong đồ thị của cùng trang đó không. */
  resolved: boolean;
  seenOn: string[];
}

export interface SampledPage {
  path: string;
  kind: string;
  /** null = không lấy được trang, hoặc trang không có JSON-LD nào. */
  blocks: number | null;
  error?: string;
}

export interface SchemaGraph {
  sampled: SampledPage[];
  nodes: SchemaNode[];
  edges: SchemaEdge[];
  /** Node không có @id — không thể được tham chiếu. */
  islands: SchemaNode[];
  /** Cạnh trỏ tới một @id không có trong cùng trang. */
  dangling: SchemaEdge[];
  /** Khuôn trang không có đại diện nào trong mẫu. */
  notSampled: string[];
}

type Json = Record<string, unknown>;

function extractJsonLd(html: string): Json[] {
  const out: Json[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed: unknown = JSON.parse(m[1]);
      const graph = (parsed as Json)?.["@graph"];
      if (Array.isArray(graph)) out.push(...(graph as Json[]));
      else if (parsed && typeof parsed === "object") out.push(parsed as Json);
    } catch {
      // Một khối JSON-LD hỏng cú pháp KHÔNG làm hỏng cả bản đồ: các khối khác
      // trên cùng trang vẫn đọc được, và verify-technical-rules là chỗ bắt lỗi
      // cú pháp. Ở đây nó chỉ đơn giản không đóng góp node nào.
    }
  }
  return out;
}

function typeOf(node: Json): string {
  const t = node["@type"];
  if (typeof t === "string") return t;
  if (Array.isArray(t) && typeof t[0] === "string") return t[0];
  return "(không có @type)";
}

/** Mọi cặp (thuộc tính, @id) mà node này trỏ ra. */
function refsOf(node: Json): { property: string; toId: string }[] {
  const out: { property: string; toId: string }[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("@")) continue;
    const take = (x: unknown) => {
      if (x && typeof x === "object" && !Array.isArray(x)) {
        const id = (x as Json)["@id"];
        if (typeof id === "string") out.push({ property: k, toId: id });
      }
    };
    if (Array.isArray(v)) v.forEach(take);
    else take(v);
  }
  return out;
}

/**
 * Chọn mẫu: một trang cho mỗi khuôn.
 *
 * Trang tĩnh lấy từ danh sách cố định vì chúng không có trong tồn kho —
 * /api/inventory chỉ liệt kê trang thị trường và trang cụm.
 */
async function pickSample(siteUrl: string, vertical: string): Promise<{ sample: { path: string; kind: string }[]; notSampled: string[] }> {
  const sample: { path: string; kind: string }[] = [
    { path: "/", kind: "trang chủ" },
    { path: `/${vertical}`, kind: "trang ngành" },
    { path: "/data", kind: "trang dữ liệu" },
    { path: "/blog", kind: "danh sách bài viết" },
    { path: "/about", kind: "trang tĩnh" },
  ];
  const notSampled: string[] = [];

  try {
    const inv = await fetchServedInventory(siteUrl);
    const market = [...inv.byZip.entries()].find(([zip]) => inv.kindByZip.get(zip) === "market");
    const cluster = [...inv.byZip.entries()].find(([zip]) => inv.kindByZip.get(zip) === "cluster");
    if (market) sample.push({ path: market[1], kind: "trang thị trường" });
    else notSampled.push("trang thị trường");
    if (cluster) sample.push({ path: cluster[1], kind: "trang cụm" });
    else notSampled.push("trang cụm");

    // Trang bang: suy từ đường dẫn thị trường, bớt đoạn cuối.
    const hub = market?.[1].split("/").slice(0, -1).join("/");
    if (hub) sample.push({ path: hub, kind: "trang bang" });
    else notSampled.push("trang bang");
  } catch {
    notSampled.push("trang thị trường", "trang cụm", "trang bang");
  }

  return { sample, notSampled };
}

export async function buildSchemaGraph(siteUrl: string, vertical: string): Promise<SchemaGraph> {
  const base = siteUrl.replace(/\/+$/, "");
  const { sample, notSampled } = await pickSample(siteUrl, vertical);

  const sampled: SampledPage[] = [];
  const nodeMap = new Map<string, SchemaNode>();
  const edgeMap = new Map<string, SchemaEdge>();

  for (const { path, kind } of sample) {
    let html: string;
    try {
      const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) {
        sampled.push({ path, kind, blocks: null, error: `HTTP ${res.status}` });
        continue;
      }
      html = await res.text();
    } catch (err) {
      sampled.push({ path, kind, blocks: null, error: err instanceof Error ? err.message.slice(0, 80) : "không lấy được" });
      continue;
    }

    const nodes = extractJsonLd(html);
    sampled.push({ path, kind, blocks: nodes.length });

    // @id có mặt TRONG CHÍNH TRANG NÀY. Phạm vi là trang, không phải site:
    // một @id chỉ giải được nếu nó nằm trong cùng đồ thị mà trình đọc nhận.
    const idsHere = new Set(nodes.map((n) => n["@id"]).filter((v): v is string => typeof v === "string"));

    for (const n of nodes) {
      const type = typeOf(n);
      const id = typeof n["@id"] === "string" ? (n["@id"] as string) : null;
      const key = `${type}|${id ?? ""}`;
      const prev = nodeMap.get(key);
      if (prev) prev.seenOn.push(path);
      else nodeMap.set(key, { type, id, seenOn: [path] });

      for (const r of refsOf(n)) {
        const ekey = `${type}|${r.property}|${r.toId}`;
        const resolved = idsHere.has(r.toId);
        const pe = edgeMap.get(ekey);
        if (pe) {
          pe.seenOn.push(path);
          // Một cạnh giải được ở trang này mà không giải được ở trang khác vẫn
          // là vấn đề — giữ kết quả XẤU hơn.
          pe.resolved = pe.resolved && resolved;
        } else {
          edgeMap.set(ekey, { fromType: type, property: r.property, toId: r.toId, resolved, seenOn: [path] });
        }
      }
    }
  }

  const nodes = [...nodeMap.values()].sort((a, b) => b.seenOn.length - a.seenOn.length);
  const edges = [...edgeMap.values()].sort((a, b) => b.seenOn.length - a.seenOn.length);
  return {
    sampled,
    nodes,
    edges,
    islands: nodes.filter((n) => n.id === null),
    dangling: edges.filter((e) => !e.resolved),
    notSampled,
  };
}
