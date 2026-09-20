/**
 * Bản đồ liên kết TRANG ↔ TRANG, dựng từ breadcrumb trong JSON-LD.
 *
 * Bản đồ cũ vẽ hình dạng schema của MỘT trang — Organization → WebSite →
 * WebPage → các phần. Hình đó giống hệt nhau trên cả 194 trang, nên nó không
 * thể trả lời câu duy nhất đáng hỏi về cấu trúc: TRANG NÀO KHÔNG AI TRỎ TỚI.
 *
 * Trong schema, liên kết trang↔trang nằm ở `BreadcrumbList.itemListElement`:
 * mỗi trang tự khai chuỗi tổ tiên của nó. Gộp breadcrumb của mọi trang lại thì
 * ra đúng một cây, và cây đó là thứ Google dùng để hiểu site có cấu trúc gì.
 *
 * MỒ CÔI = không xuất hiện trong breadcrumb của bất kỳ trang nào khác. Nó vẫn
 * nằm trong sitemap, vẫn trả 200, vẫn được index — nhưng về mặt cấu trúc nó
 * treo lơ lửng, và không phép kiểm nào khác trong hệ này nhìn thấy điều đó.
 *
 * Đo 19/9/2026 trên atmovingservices.com: 194 trang, 192 có breadcrumb, 378
 * cạnh duy nhất, và ĐÚNG MỘT trang mồ côi — /data. Quét hết mất 8,9 giây với
 * 12 request song song.
 */

export interface PageNode {
  /** Đường dẫn, không kèm origin. */
  path: string;
  /** Số trang mà trang này trỏ tới (qua breadcrumb của chúng). */
  children: string[];
  /** Trang cha theo breadcrumb, null nếu không ai trỏ tới. */
  parent: string | null;
  depth: number;
}

/**
 * Loại trang, suy từ hình dạng đường dẫn.
 *
 * Gộp theo loại là cách DUY NHẤT vẽ được liên kết nội bộ của site này thành
 * hình đọc được: 194 trang và hơn hai nghìn cạnh vẽ từng cái một ra một búi
 * tóc, trong đó không ai thấy được gì. Gộp lại thì "trang thị trường trỏ sang
 * trang cụm bao nhiêu lần" hiện thành một con số, và cạnh có trọng số vẫn là
 * cạnh THẬT — không cắt bớt, không lấy mẫu.
 *
 * Trang nào KHÔNG ai trỏ tới thì vẽ riêng từng cái, có tên. Đó là thứ cần
 * nhìn từng trang, và cũng là thứ ít ỏi đủ để vẽ.
 */
export type PageKind = "home" | "niche" | "state" | "market" | "cluster" | "pillar" | "blog" | "static";

export function kindOf(path: string, vertical: string): PageKind {
  if (path === "/") return "home";
  const seg = path.split("/").filter(Boolean);
  if (seg[0] === "blog") return "blog";
  if (seg[0] !== vertical) return STATIC_PATHS.has(`/${seg[0]}`) ? "static" : "pillar";
  if (seg.length === 1) return "niche";
  if (seg.length === 2) return "state";
  // /{niche}/{state}/{slug}: slug kết thúc bằng 5 chữ số = một ZIP lẻ.
  return /-\d{5}$/.test(seg[2] ?? "") ? "market" : "cluster";
}

/** Trang tĩnh viết tay. Khác trang trụ ở chỗ trang trụ mang số liệu gộp. */
const STATIC_PATHS = new Set(["/about", "/contact", "/data", "/privacy", "/terms", "/blog"]);

export interface LinkStats {
  /** Cạnh gộp theo loại: "market→cluster" -> số liên kết. */
  byKind: Map<string, number>;
  /** Số trang mỗi loại. */
  countByKind: Map<PageKind, number>;
  /** Số liên kết vào từng trang, từ trang KHÁC. */
  inbound: Map<string, number>;
  /** Trang không trang nào trỏ tới bằng thẻ <a> thật. Khác `orphans`, vốn
   *  tính theo breadcrumb: một trang có thể có breadcrumb đúng mà không ai
   *  đặt liên kết tới, và ngược lại. */
  unlinked: string[];
  /** Trang không trỏ đi đâu cả — ngõ cụt cho người đọc lẫn cho bot. */
  deadEnds: string[];
  /** Tổng số cạnh (liên kết nội bộ giữa hai trang khác nhau). */
  edges: number;
}

export interface PageGraph {
  siteUrl: string;
  total: number;
  nodes: Map<string, PageNode>;
  /** Trang không xuất hiện trong breadcrumb của trang nào khác. */
  orphans: string[];
  /** Trang không phát BreadcrumbList nào — không tự khai tổ tiên. */
  noBreadcrumb: string[];
  /** Trang lấy về lỗi. Nêu ra vì một trang không soi được KHÔNG phải trang
   *  lành: gộp nó vào nhóm lành là cách bỏ sót đúng thứ đang hỏng. */
  failed: { path: string; reason: string }[];
  /** Liên kết nội bộ THẬT — thẻ <a href> trong HTML, không phải breadcrumb. */
  links: LinkStats;
  elapsedMs: number;
}

const CONCURRENCY = 12;

function pathOf(url: string, base: string): string {
  return url.replace(base, "").replace(/\/+$/, "") || "/";
}

function breadcrumbItems(html: string): string[] | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const graph = (parsed as Record<string, unknown>)["@graph"];
    const nodes: Record<string, unknown>[] = Array.isArray(graph)
      ? (graph as Record<string, unknown>[])
      : [parsed as Record<string, unknown>];
    const bc = nodes.find((n) => n["@type"] === "BreadcrumbList");
    if (!bc) continue;
    const list = bc["itemListElement"];
    if (!Array.isArray(list)) continue;
    const items = list
      .map((x) => (x as Record<string, unknown>)?.["item"])
      .filter((v): v is string => typeof v === "string");
    return items.length > 0 ? items : null;
  }
  return null;
}

/**
 * Đường dẫn nội bộ trong HTML.
 *
 * Chỉ lấy href bắt đầu bằng "/" — liên kết tuyệt đối tới chính site vẫn đếm,
 * nhưng khuôn của site này không sinh loại đó, và nhận diện chúng đòi so
 * origin mà origin thì khác nhau giữa hai site. Bỏ neo (#), bỏ query: hai thứ
 * đó trỏ cùng một trang, và đếm chúng thành cạnh riêng sẽ thổi phồng con số
 * duy nhất mà hình này dùng.
 */
function internalHrefs(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) {
    const raw = m[1];
    if (!raw.startsWith("/")) continue;
    const clean = raw.split("#")[0].split("?")[0].replace(/\/+$/, "") || "/";
    out.add(clean);
  }
  return [...out];
}

export async function buildPageGraph(siteUrl: string, vertical: string): Promise<PageGraph> {
  const started = Date.now();
  const base = siteUrl.replace(/\/+$/, "");

  const smRes = await fetch(`${base}/sitemap.xml`, { signal: AbortSignal.timeout(15000) });
  const sm = await smRes.text();
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  const nodes = new Map<string, PageNode>();
  /** path → những trang nó trỏ tới. */
  const outbound = new Map<string, string[]>();
  const noBreadcrumb: string[] = [];
  const failed: { path: string; reason: string }[] = [];
  const ensure = (p: string): PageNode => {
    const n = nodes.get(p) ?? { path: p, children: [], parent: null, depth: 0 };
    nodes.set(p, n);
    return n;
  };
  for (const u of urls) ensure(pathOf(u, base));

  const link = (parentPath: string, childPath: string) => {
    if (parentPath === childPath) return;
    const parent = ensure(parentPath);
    const child = ensure(childPath);
    if (!parent.children.includes(childPath)) parent.children.push(childPath);
    // Cha ĐẦU TIÊN thắng. Một trang có thể xuất hiện trong breadcrumb của
    // nhiều nhánh; lấy cha sau sẽ làm cây đổi hình theo thứ tự quét, tức theo
    // một thứ không ai kiểm soát.
    if (child.parent === null) child.parent = parentPath;
  };

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    await Promise.all(
      urls.slice(i, i + CONCURRENCY).map(async (u) => {
        const path = pathOf(u, base);
        let html: string;
        try {
          const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
          if (!res.ok) {
            failed.push({ path, reason: `HTTP ${res.status}` });
            return;
          }
          html = await res.text();
        } catch (err) {
          failed.push({ path, reason: err instanceof Error ? err.message.slice(0, 60) : "không lấy được" });
          return;
        }

        // Liên kết thật, đọc từ CÙNG một lần tải. Không thêm request nào:
        // vòng quét này vốn đã tải đủ mọi trang để đọc breadcrumb.
        outbound.set(path, internalHrefs(html));

        const items = breadcrumbItems(html);
        if (!items) {
          // Trang chủ KHÔNG cần breadcrumb — nó không có tổ tiên nào để khai.
          // Liệt nó vào danh sách thiếu là dạy người đọc bỏ qua danh sách đó.
          if (path !== "/") noBreadcrumb.push(path);
          return;
        }
        // Breadcrumb liệt kê tổ tiên; trang hiện tại là mắt cuối (hoặc thiếu,
        // với vài khuôn). Nối từng mắt, rồi nối mắt cuối tới chính trang này.
        const chain = items.map((x) => pathOf(x, base));
        for (let k = 1; k < chain.length; k++) link(chain[k - 1], chain[k]);
        link(chain[chain.length - 1], path);
      })
    );
  }

  // Độ sâu tính từ cha, không từ số dấu "/": một trang có thể nằm nông trong
  // URL mà sâu trong cây, và ngược lại.
  const depthOf = (p: string, seen = new Set<string>()): number => {
    const n = nodes.get(p);
    if (!n || n.parent === null || seen.has(p)) return 0;
    seen.add(p);
    return 1 + depthOf(n.parent, seen);
  };
  for (const n of nodes.values()) n.depth = depthOf(n.path);

  const orphans = [...nodes.values()]
    .filter((n) => n.parent === null && n.path !== "/")
    .map((n) => n.path)
    .sort();

  /**
   * Chỉ đếm cạnh tới trang CÓ TRONG SITEMAP.
   *
   * Một liên kết trỏ ra ngoài tập đó là chuyện khác hẳn — có thể là trang
   * chưa publish, có thể là liên kết hỏng — và trộn nó vào hình cấu trúc sẽ
   * làm con số nói sai. Trang không có trong sitemap cũng không có điểm để
   * nối tới.
   */
  const known = new Set(nodes.keys());
  const inbound = new Map<string, number>();
  const byKind = new Map<string, number>();
  const countByKind = new Map<PageKind, number>();
  let edges = 0;
  for (const p of known) countByKind.set(kindOf(p, vertical), (countByKind.get(kindOf(p, vertical)) ?? 0) + 1);
  for (const [from, tos] of outbound) {
    const fromKind = kindOf(from, vertical);
    for (const to of tos) {
      if (to === from || !known.has(to)) continue;
      edges++;
      inbound.set(to, (inbound.get(to) ?? 0) + 1);
      const key = `${fromKind}→${kindOf(to, vertical)}`;
      byKind.set(key, (byKind.get(key) ?? 0) + 1);
    }
  }
  const unlinked = [...known].filter((p) => p !== "/" && (inbound.get(p) ?? 0) === 0).sort();
  const deadEnds = [...known]
    .filter((p) => (outbound.get(p) ?? []).filter((t) => t !== p && known.has(t)).length === 0)
    .sort();

  return {
    siteUrl: base,
    total: urls.length,
    links: { byKind, countByKind, inbound, unlinked, deadEnds, edges },
    nodes,
    orphans,
    noBreadcrumb: noBreadcrumb.sort(),
    failed,
    elapsedMs: Date.now() - started,
  };
}
