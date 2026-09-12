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
 * Ý định giờ là một CHUỖI ĐO ĐƯỢC, không phải một union tự nghĩ ra.
 *
 * Ở đây từng có `type Intent = "move-underway" | "choosing-place" |
 * "market-context"` cùng bảng INTENT_BY_METRIC gán mỗi chỉ số cho một trong
 * ba. Cả hai do tôi khai báo, và chính comment cạnh chúng đã ghi "DECLARED,
 * not measured" trong khi giao diện vẫn dựng trên chúng như trên dữ liệu.
 *
 * Ý định thật đến từ nghiên cứu từ khoá của ngành — lib/keywords/intents.ts
 * đọc search_intent_info mà DataForSEO đã trả sẵn. Đo 11/9/2026 cho
 * moving-services: commercial (5 từ khoá, 40,100 volume) và informational
 * (1 từ khoá, 12,100). Không phải ba, và không cỡ bằng nhau.
 *
 * Ý định quyết định TIÊU ĐỀ và TEMPLATE — hai thứ nói về truy vấn trang này
 * nhắm tới. Nó KHÔNG còn quyết định thứ tự chỉ số: không có phép đo nào nối
 * "median home value" với "commercial", nên sắp xếp theo nó là khai báo trá
 * hình một lần nữa.
 */
export type Intent = string;

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
function titleFor(intent: Intent, city: string, state: string, zip: string): string {
  // Có ZIP trong tiêu đề vì SỐ LIỆU là của ZIP đó.
  //
  // Hai lý do, cả hai đều đo được. (1) Duy nhất theo cấu tạo: 48/174 ứng viên
  // từng chung đúng một tiêu đề "Moving services in New York, NY" — 47 bài sẽ
  // trượt not-duplicate-title, mỗi bài sau ba lần gọi API mà model không sửa
  // được vì tiêu đề do template sinh. (2) Trung thực về phạm vi: bảng bên
  // dưới ghi "ZIP 10002", nên tiêu đề nói "New York, NY" là hứa rộng hơn thứ
  // trang thật sự đo — cùng lỗi scope_overclaim, chỉ chuyển lên tiêu đề.
  switch (intent) {
    case "commercial":
      return `Moving services in ${city}, ${state} ${zip}`;
    case "transactional":
      return `Book your move in ${city}, ${state} ${zip}`;
    case "informational":
      return `Moving in ${city}, ${state} ${zip}: the published figures`;
    case "navigational":
      return `${city}, ${state} ${zip}: moving and housing figures`;
    default:
      return `${city}, ${state} ${zip}: moving and housing figures`;
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
export function orderFactsByScope(facts: Fact[]): Fact[] {
  // Chỉ số đo TẠI ZIP lên trước, county/state xuống sau.
  //
  // Đây là thứ tự ĐO ĐƯỢC: trang nói về một ZIP, nên con số đo đúng ở ZIP đó
  // cụ thể hơn con số đo cho cả county. Bản trước sắp theo intent, mà không
  // có phép đo nào nối một chỉ số với một ý định tìm kiếm — nó chỉ là bảng
  // tôi tự gán, đội lốt xếp hạng theo dữ liệu.
  const rank = (f: Fact) => (f.scope === "ZIP" ? 0 : f.scope === "COUNTY" ? 1 : 2);
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
  /** Ý định ĐO được cho thị trường này. null = chưa đo, không phải "không có". */
  intent: Intent | null;
  metricCount: number;

  /** Từ khoá thị trường này thật sự sống bằng (volume cao nhất của nó), kèm
   * số liệu của chính nó. null/0 khi chưa đo được từ khoá nào — và 0 ở đây
   * KHÔNG có nghĩa "không ai tìm", nó có nghĩa "chưa ai đo". */
  keyword: string | null;
  searchVolume: number;
  cpc: number;
  keywordDifficulty: number;

  /** Đây là bài thứ mấy nhắm vào cùng từ khoá đó, trên tổng bao nhiêu bài
   * cùng nhắm. rank 1 = bài đầu tiên cho từ khoá này. */
  keywordRank: number;
  keywordShareCount: number;
}

/**
 * Ngưỡng phân nhóm quan trọng, TÍNH TỪ chính phân bố của ngành này.
 *
 * Không đặt con số tuyệt đối. "Trên 5.000 là cao" nghe hợp lý cho một ngành
 * và vô nghĩa cho ngành khác; một ngưỡng khai báo sẵn sẽ nói sai về mọi ngành
 * trừ ngành nó được viết cho.
 *
 * Đo trên moving-services 11/9/2026: nhỏ nhất 10, p25 720, trung vị 2.900,
 * p75 6.600, cao nhất 18.100.
 *
 * Đánh đổi phải biết: nhãn này TƯƠNG ĐỐI. Một thị trường có thể rơi từ "cao"
 * xuống "vừa" mà volume của nó không đổi, chỉ vì những nơi khác được đo thêm.
 * Vì vậy con số volume luôn hiện cạnh nhãn — nhãn để quét nhanh, con số mới
 * là thứ so sánh được qua thời gian.
 */
export function volumeThresholds(volumes: number[]): { high: number; mid: number } {
  const sorted = volumes.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { high: 0, mid: 0 };
  const at = (pct: number) => sorted[Math.floor((sorted.length - 1) * pct)];
  return { high: at(0.75), mid: at(0.25) };
}

/**
 * Ngưỡng cho CẢ NGÀNH, một thang duy nhất.
 *
 * Đo 11/9/2026: tính ngưỡng trong từng nhóm ý định thì Brockton, MA (90
 * lượt/tháng) được gắn "cao" — vì nhóm navigational chỉ có 10 ứng viên,
 * volume 70–90, nên 90 đúng là top quartile CỦA NHÓM ĐÓ. Nhưng 90 so với
 * 18.100 của nhóm commercial thì "cao" là nói sai, và người đọc so hai tab
 * với nhau sẽ tin hai thứ khác cỡ nhau là bằng nhau.
 *
 * Một thang cho cả ngành cũng nói thêm được điều nhóm-riêng không nói: rằng
 * cả nhóm navigational nhỏ, không chỉ từng thị trường trong đó.
 *
 * Lấy volume LỚN NHẤT cho mỗi chuỗi từ khoá: cùng một từ khoá đo nhiều lần
 * thì lần cao nhất là con số của nó, và đếm mỗi lần đo một phiếu sẽ cho từ
 * khoá được đo nhiều lần nặng hơn.
 */
export async function nicheVolumeThresholds(vertical: string): Promise<{ high: number; mid: number }> {
  const rows = await prisma.keywordMetric.findMany({
    where: { marketIdentity: { vertical } },
    select: { keyword: true, searchVolume: true },
  });
  const byKeyword = new Map<string, number>();
  for (const r of rows) byKeyword.set(r.keyword, Math.max(byKeyword.get(r.keyword) ?? 0, r.searchVolume));
  return volumeThresholds([...byKeyword.values()]);
}

export function importanceOf(volume: number, t: { high: number; mid: number }): "cao" | "vừa" | "thấp" | "chưa đo" {
  if (volume <= 0) return "chưa đo";
  if (volume >= t.high) return "cao";
  if (volume >= t.mid) return "vừa";
  return "thấp";
}

export async function discoverCandidates(
  vertical: string,
  opts: { intent?: Intent; servedPaths?: Set<string> } = {}
): Promise<CandidateSummary[]> {

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
  const rawIdentities = await prisma.marketIdentity.findMany({
    where: { vertical },
    select: {
      zip: true,
      keywordMetrics: {
        select: { keyword: true, searchVolume: true, cpc: true, keywordDifficulty: true, mainIntent: true },
        orderBy: { fetchedAt: "desc" },
      },
    },
  });
  const identities = rawIdentities.filter((i) => i.keywordMetrics.some((k) => k.searchVolume > 0));
  if (identities.length === 0) return [];

  /**
   * Ý định của TỪNG thị trường, từ từ khoá của chính nó.
   *
   * Đo 11/9/2026: 198 từ khoá của moving-services ra 133 commercial, 41
   * informational, 13 navigational, 11 transactional — và khác nhau không nằm
   * ở mẫu câu. Cùng "movers {city}": chicago là informational, pflugerville
   * là transactional. Dùng một nhãn cho cả ngành là áp nhãn của đa số lên 65
   * thị trường không thuộc nhóm đó.
   *
   * Lấy từ khoá có volume cao nhất làm đại diện: đó là truy vấn thị trường
   * này thật sự sống bằng, không phải trung bình của những truy vấn không ai
   * gõ.
   */
  const leadByZip = new Map<
    string,
    { keyword: string; searchVolume: number; cpc: number; keywordDifficulty: number; mainIntent: string | null }
  >();
  for (const i of identities) {
    const lead = [...i.keywordMetrics].sort((a2, b2) => b2.searchVolume - a2.searchVolume)[0];
    if (lead) leadByZip.set(i.zip, lead);
  }

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

    // Ý định của thị trường này. Chưa đo thì để null và VẪN liệt kê — bỏ nó
    // đi sẽ giấu mất một nơi có đủ dữ liệu chỉ vì khâu đo ý định chưa chạy,
    // và danh sách ngắn đi mà không nói vì sao là thứ không ai phát hiện.
    const lead = leadByZip.get(loc.zip);
    const marketIntent = lead?.mainIntent ?? null;
    if (opts.intent && marketIntent !== opts.intent) continue;
    out.push({
      id: `${vertical}:${loc.zip}`,
      vertical,
      zip: loc.zip,
      city: loc.city,
      state: loc.state,
      county: loc.county,
      title: titleFor(marketIntent ?? "", loc.city, loc.state, loc.zip),
      why:
        `${n} chỉ số đo được ở ${loc.city}, ${loc.state} (ZIP ${loc.zip})` +
        (marketIntent ? `, từ khoá ở đây là ý định "${marketIntent}".` : ", CHƯA đo ý định từ khoá."),
      intent: marketIntent,
      metricCount: n,
      keyword: lead?.keyword ?? null,
      searchVolume: lead?.searchVolume ?? 0,
      cpc: lead?.cpc ?? 0,
      keywordDifficulty: lead?.keywordDifficulty ?? 0,
      keywordRank: 1,
      keywordShareCount: 1,
    });
  }
  // Sắp theo VOLUME giảm dần, không theo ZIP.
  //
  // Thứ tự cũ là ZIP tăng dần — một thứ tự không mang thông tin nào, và nó
  // đẩy Brockton, MA (90 lượt/tháng, xếp 512/538) lên đầu danh sách trong khi
  // những thị trường 18.100 lượt nằm đâu đó phía dưới.
  //
  // Sắp ở ĐÂY, không sắp ở giao diện: hàng đợi của lô cũng đọc hàm này, nên
  // "tạo 10 bài" phải là 10 bài đáng viết nhất, không phải 10 ZIP nhỏ nhất.
  out.sort((a, b) => b.searchVolume - a.searchVolume || a.zip.localeCompare(b.zip));

  /**
   * TRẢI RỘNG trước, ĐÀO SÂU sau.
   *
   * Sắp theo volume đơn thuần cho ra kết quả trông đúng mà hỏng: đo 11/9/2026
   * trên ý định commercial, 125 ứng viên dùng 78 từ khoá, nhưng 48 ứng viên
   * chung đúng một từ khoá "moving companies new york" — và 10 ứng viên đầu
   * theo volume dùng ĐÚNG MỘT từ khoá. Bấm "viết 10 bài quan trọng nhất" sẽ
   * dựng 10 trang New York tranh nhau một truy vấn.
   *
   * Nên thứ tự là: bản ĐẦU TIÊN của mỗi từ khoá, theo volume giảm dần; rồi
   * mới tới các bản thứ hai, thứ ba. Mười bài đầu thành mười từ khoá khác
   * nhau.
   *
   * Không LOẠI bản thứ hai: nhiều ZIP trong một thành phố vẫn có số liệu khác
   * nhau và vẫn là trang hợp lệ. Chỉ là chúng không đáng viết trước khi mọi
   * từ khoá khác có bài đầu tiên.
   */
  const seenKeyword = new Map<string, number>();
  for (const c of out) {
    const k = c.keyword ?? "";
    const rank = (seenKeyword.get(k) ?? 0) + 1;
    seenKeyword.set(k, rank);
    c.keywordRank = rank;
  }
  const shareCount = new Map<string, number>(seenKeyword);
  for (const c of out) c.keywordShareCount = shareCount.get(c.keyword ?? "") ?? 1;

  out.sort(
    (a, b) =>
      a.keywordRank - b.keywordRank ||
      b.searchVolume - a.searchVolume ||
      a.zip.localeCompare(b.zip)
  );
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

  const facts = orderFactsByScope(set.facts);
  return {
    id: `${vertical}:${zip}`,
    vertical,
    zip,
    city: loc.city,
    state: loc.state,
    county: loc.county,
    title: titleFor(intent, loc.city, loc.state, zip),
    why: `${facts.length} chỉ số đo được ở ${loc.city}, ${loc.state}.`,
    intent,
    scope: { kind: "ZIP", name: `${loc.city}, ${loc.state}` },
    facts,
    fingerprint: set.fingerprint,
  };
}
