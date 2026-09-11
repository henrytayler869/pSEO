import { prisma } from "@/lib/db/prisma";
import { buildFactSet } from "@/lib/ai/facts";
import type { Fact } from "@/lib/ai/facts";

/**
 * Ứng viên bài viết: MỘT ĐỊA ĐIỂM, toàn bộ chỉ số đo được ở đó.
 *
 * Bản trước cắt kho dữ liệu theo CHỈ SỐ — "5 county xếp theo thu nhập" — nên
 * mỗi bài chỉ còn một con số, và không bài nào nói được hai chỉ số của cùng
 * một nơi liên hệ với nhau ra sao. Đo 11/9/2026: cả 228/228 ứng viên có đúng
 * một chỉ số. Đó là listicle biên tập, không phải programmatic SEO, và nó
 * không phải thứ dataset này dựng ra để phục vụ.
 *
 * Cắt theo địa điểm thì 13–21 chỉ số của nơi đó cùng nằm trên một trang, và
 * lớp diễn giải AI mới có đủ thứ để ráp thành một bài hoàn chỉnh.
 *
 * Fact dựng bằng buildFactSet — chính hàm trang market đang dùng. Dùng lại
 * chứ không viết lần hai: nhãn, phạm vi đo và fingerprint phải giống hệt, nếu
 * không thì cùng một ZIP sẽ có hai định nghĩa "sự thật" trong một hệ thống.
 */

/**
 * What the reader is trying to do when they land on the article.
 *
 * Added after the first batch of candidates came out data-first — "5 ZIPs in
 * AZ lead on homeownership" — which attracts someone curious about numbers,
 * not someone who needs a mover. The dataset was being asked "what is
 * interesting here" when the business question is "who is about to move".
 *
 *   move-underway    the reader is moving, or has just moved. Served by the
 *                    figures that measure MOVING itself.
 *   choosing-place   the reader is deciding between places. Served by the
 *                    figures that describe what a place costs and who owns
 *                    there.
 *   market-context   background. Real, and lowest intent — this is what the
 *                    first batch was, all of it.
 *
 * Intent changes WHICH figures are eligible and how the piece is framed. It
 * does NOT license supply-side claims: no dataset here measures what movers
 * charge or how busy they are, and `rendered-supply-side-bridge` still
 * rejects a figure hung on a claim about companies. Commercial intent is
 * served by directing the READER — which the content rules explicitly permit
 * — not by asserting about suppliers.
 */
export type Intent = "move-underway" | "choosing-place" | "market-context";

/**
 * Which intent a metric can honestly serve, for THIS trade.
 *
 * DECLARED, not measured — unlike resolution, which is read from the data.
 * There is no column saying "this number speaks to someone mid-move"; that is
 * a judgement about what the figure means to a reader, and it is written here
 * so it can be argued with rather than left implicit in a prompt.
 *
 * Keyed by trade because the same metric serves different intents elsewhere:
 * `census_moved_from_different_state` is the whole subject for a mover and
 * mere background for a roofer. Anything unlisted falls to market-context,
 * which is the honest default — the figure is real, it just does not speak to
 * a person with a job to hire for.
 */
const INTENT_BY_METRIC: Record<string, Record<string, Intent>> = {
  "moving-services": {
    census_moved_from_different_state: "move-underway",
    census_moved_from_different_county: "move-underway",
    census_moved_within_county: "move-underway",
    census_moved_from_abroad: "move-underway",
    census_mobility_rate_pct: "move-underway",
    irs_migration_inflow_households: "move-underway",
    irs_migration_outflow_households: "move-underway",
    irs_migration_net_households: "move-underway",

    census_median_home_value_usd: "choosing-place",
    census_median_household_income_usd: "choosing-place",
    census_homeownership_rate_pct: "choosing-place",
    irs_migration_inflow_agi_usd: "choosing-place",
  },
};

export function isIntent(v: string | undefined): v is Intent {
  return v === "move-underway" || v === "choosing-place" || v === "market-context";
}

export function intentOf(vertical: string, metric: string): Intent {
  return INTENT_BY_METRIC[vertical]?.[metric] ?? "market-context";
}

/* Bộ từ vựng nhãn chỉ số ĐÃ BỎ khỏi file này.
 *
 * Nó từng có một bảng METRIC_PHRASE riêng, trong khi lib/ai/facts.ts đã có
 * METRIC_LABELS cho đúng việc đó. Hai bộ từ vựng song song cho cùng một tập
 * chỉ số chỉ trùng nhau tới lần đầu có người sửa một bên.
 */




/**
 * Tiêu đề bài, theo việc người đọc đang làm.
 *
 * TIẾNG ANH, vì nó thành tiêu đề bài WordPress trên site tiếng Anh — khác với
 * `why`, viết cho người vận hành đọc danh sách này.
 *
 * Không tiêu đề nào hứa điều dataset không đo: không nói gì về hãng vận
 * chuyển, giá cước hay lịch trống.
 */
function titleFor(intent: Intent, city: string, state: string): string {
  switch (intent) {
    case "move-underway":
      return `Moving to ${city}, ${state}? What the local figures show`;
    case "choosing-place":
      return `Living in ${city}, ${state}: homes, income and who owns`;
    default:
      return `${city}, ${state} by the numbers`;
  }
}

export interface ArticleCandidate {
  /** Ổn định giữa các lần chạy cho cùng một nơi, để bài đã viết nhận ra được
   * mà không bị mời viết lại. */
  id: string;
  vertical: string;
  zip: string;
  city: string;
  state: string;
  county: string | null;
  /** Gợi ý tiêu đề, dựng theo intent đang chọn. */
  title: string;
  /** Vì sao nơi này đáng viết, nói bằng chính con số làm nó đúng. */
  why: string;
  intent: Intent;
  scope: { kind: "ZIP"; name: string };
  /** TOÀN BỘ số bài này được phép dùng — mọi chỉ số đo được ở nơi này. */
  facts: Fact[];
  /** Fingerprint của fact set, để dùng lại đoạn AI đã sinh cho cùng dữ liệu
   * thay vì trả tiền lần nữa. */
  fingerprint: string;
}

function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Sắp fact theo intent: chỉ số phục vụ ý định đang chọn lên trước.
 *
 * Intent KHÔNG lọc bớt fact. Bỏ đi những con số khác chính là quay lại lỗi
 * một-chỉ-số-một-bài; thứ intent quyết định là bài MỞ ĐẦU bằng gì, không phải
 * bài được biết những gì.
 */
export function orderFactsForIntent(vertical: string, intent: Intent, facts: Fact[]): Fact[] {
  const rank = (f: Fact) => (intentOf(vertical, f.key) === intent ? 0 : 1);
  return [...facts].sort((a, b) => rank(a) - rank(b));
}

/**
 * Mọi địa điểm có dữ liệu cho ngành này, trừ những nơi site ĐÃ phục vụ.
 *
 * `servedPaths` là đường dẫn thật lấy từ sitemap của publisher. Viết thêm một
 * bài WordPress về đúng ZIP đã có trang market là tự dựng hai trang cạnh tranh
 * nhau trên cùng domain — đúng hình dạng near-duplicate mà cổng khác biệt hoá
 * của dự án này sinh ra để chặn. Đo 11/9/2026: 300 địa điểm có dữ liệu, 82
 * trong số đó đã có trang, còn 218 nơi chưa.
 *
 * Bỏ trống `servedPaths` thì KHÔNG loại trừ gì — và đó là lựa chọn ồn: thà
 * mời viết trùng rồi thấy rõ, còn hơn im lặng bỏ qua nơi lẽ ra nên viết vì
 * một lần gọi sitemap hỏng.
 */
/**
 * Danh sách ứng viên — MỘT truy vấn gộp, không dựng fact set.
 *
 * Đo 11/9/2026: buildFactSet mất 2.6–5.3 giây một ZIP qua tunnel. Dựng sẵn
 * cho 218 nơi là ~10 phút cho một trang danh sách. Fact chỉ cần lúc VIẾT, nên
 * nó dựng lúc viết — một lần gọi API tốn nhiều hơn thế nhiều lần.
 *
 * `metricCount` đếm số chỉ số KHÁC NHAU từ snapshot OK, nên nó không phụ
 * thuộc vào việc dedup snapshot: một chỉ số thu 13 lần vẫn là một chỉ số.
 */
export interface CandidateSummary {
  id: string;
  vertical: string;
  zip: string;
  city: string;
  state: string;
  county: string | null;
  title: string;
  why: string;
  intent: Intent;
  metricCount: number;
}

export async function discoverCandidates(
  vertical: string,
  opts: { intent?: Intent; servedPaths?: Set<string> } = {}
): Promise<CandidateSummary[]> {
  const intent = opts.intent ?? "move-underway";

  /**
   * Chỉ những ZIP mà buildFactSet THẬT SỰ dựng được.
   *
   * buildFactSet trả null khi thiếu MarketIdentity hoặc khi tổng search volume
   * bằng 0, nên chỉ đếm DataPoint là chưa đủ: đo 11/9/2026, danh sách mời 218
   * nơi mà nơi đầu tiên (ZIP 00725) viết không được. Một danh sách mời việc
   * không làm được thì mỗi lần bấm là một lần thất bại, và lỗi hiện ra ở màn
   * hình viết bài chứ không ở chỗ sinh ra nó.
   *
   * Điều kiện ở đây phải khớp điều kiện trong buildFactSet. Chúng ở hai file,
   * nên scripts/test-candidates.ts khẳng định mọi ứng viên được liệt kê đều
   * dựng được — nếu một bên đổi, bộ test đổ.
   */
  const identities = (
    await prisma.marketIdentity.findMany({
      where: { vertical },
      select: { zip: true, keywordMetrics: { select: { searchVolume: true } } },
    })
  ).filter((i) => i.keywordMetrics.some((k) => k.searchVolume > 0));
  if (identities.length === 0) return [];

  const locations = await prisma.location.findMany({
    where: { zip: { in: identities.map((i) => i.zip) } },
    select: { id: true, zip: true, city: true, state: true, county: true },
    orderBy: { zip: "asc" },
  });

  // Chỉ nguồn đã gắn cho ngành này. Không có bước lọc này thì một công ty
  // chuyển nhà nhận được ứng viên đầy số liệu bức xạ mặt trời — lỗi đã xảy ra
  // một lần với lớp ứng viên trước.
  const sources = await prisma.dataSource.findMany({
    where: { isActive: true, relevantVerticals: { has: vertical } },
    select: { id: true },
  });
  const snapshots = await prisma.dataSnapshot.findMany({
    where: { sourceId: { in: sources.map((s) => s.id) }, status: "OK" },
    select: { id: true },
  });

  const points = await prisma.dataPoint.findMany({
    where: { locationId: { in: locations.map((l) => l.id) }, snapshotId: { in: snapshots.map((s) => s.id) } },
    select: { locationId: true, metric: true },
    distinct: ["locationId", "metric"],
  });
  const countByLocation = new Map<string, number>();
  for (const p of points) countByLocation.set(p.locationId, (countByLocation.get(p.locationId) ?? 0) + 1);

  const out: CandidateSummary[] = [];
  for (const loc of locations) {
    if (!loc.city) continue;
    if (opts.servedPaths?.has(`/${vertical}/${loc.state.toLowerCase()}/${slug(loc.city)}`)) continue;
    const n = countByLocation.get(loc.id) ?? 0;
    if (n === 0) continue;
    out.push({
      id: `${vertical}:${loc.zip}`,
      vertical,
      zip: loc.zip,
      city: loc.city,
      state: loc.state,
      county: loc.county,
      title: titleFor(intent, loc.city, loc.state),
      why: `${n} chỉ số đo được ở ${loc.city}, ${loc.state} (ZIP ${loc.zip}).`,
      intent,
      metricCount: n,
    });
  }
  return out;
}

/**
 * Ứng viên đầy đủ, dựng lúc viết. Trả null khi ZIP đó không dựng được fact
 * set — im lặng bỏ qua ở đây thì bài sẽ được viết với 0 con số.
 */
export async function buildCandidate(
  vertical: string,
  zip: string,
  intent: Intent
): Promise<ArticleCandidate | null> {
  const loc = await prisma.location.findFirst({
    where: { zip },
    select: { zip: true, city: true, state: true, county: true },
  });
  if (!loc?.city) return null;

  const set = await buildFactSet(vertical, zip);
  if (!set || set.facts.length === 0) return null;

  const facts = orderFactsForIntent(vertical, intent, set.facts);
  return {
    id: `${vertical}:${zip}`,
    vertical,
    zip,
    city: loc.city,
    state: loc.state,
    county: loc.county,
    title: titleFor(intent, loc.city, loc.state),
    why: `${facts.length} chỉ số đo được ở ${loc.city}, ${loc.state}.`,
    intent,
    scope: { kind: "ZIP", name: `${loc.city}, ${loc.state}` },
    facts,
    fingerprint: set.fingerprint,
  };
}
