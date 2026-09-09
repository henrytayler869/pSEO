import { prisma } from "@/lib/db/prisma";
import { validateGeneratedText } from "@/lib/ai/validate";
import { listReservedTerms } from "@/lib/keywords/patterns";
import type { FactSet } from "@/lib/ai/facts";

/**
 * The rules every published site must enforce identically, in a form a machine
 * can check.
 *
 * WHY THIS EXISTS, and why it is not a document.
 *
 * A rule written in prose gets implemented twice — once here, once in each
 * site — and the two implementations drift without anyone seeing it. That is
 * not hypothetical: this codebase accepted a written figure within 0.5% of a
 * measured one, while the published site accepted only the roundings it had
 * actually printed. A passage landing between the two would pass here, cost
 * money to generate, get cached, and then be dropped by the site — leaving a
 * page quietly missing its interpretation, with no error anywhere connecting
 * the two halves. It was found by two agents comparing notes, not by anything
 * in either system.
 *
 * The second, third and fourth publisher would each rediscover that the same
 * way. So the rules move here, as data, and a new site INHERITS them instead
 * of reimplementing them.
 *
 * WHAT MAKES THIS DIFFERENT FROM A THIRD COPY
 *
 * Nothing here is hand-written twice. Reserved terms come from the list the
 * keyword picker actually uses. Metric resolutions are read from the data
 * points themselves. And the rounding rule is published as VECTORS produced by
 * running the real validator — accepted and rejected samples, with verdicts
 * this code did not choose. A site can then prove its own validator agrees,
 * rather than read a description and hope.
 */

export interface ConformanceVector {
  /** What a site's validator is expected to conclude for this text. */
  expect: "accept" | "reject";
  text: string;
  /** The facts the text is written against, so the vector is self-contained. */
  facts: { key: string; value: number; display: string; unit: string; scope: string; scopeName: string | null }[];
  why: string;
}

export interface ContentRules {
  version: string;
  generatedAt: string;

  rounding: {
    policy: "displayed-only";
    description: string;
    /** Verdicts produced by the live validator, not by hand. */
    vectors: ConformanceVector[];
  };

  reservedTerms: { term: string; ownedBy: string }[];

  /**
   * Which geography each metric is actually measured at, read from collected
   * data rather than declared.
   *
   * A site aggregating across ZIPs must key COUNTY metrics by county or it
   * multiplies them. Measured across 256 ZIPs in 97 counties:
   *
   *   irs_migration_net_households    13.07x   <- worst, and in use on a pillar
   *   irs_migration_outflow            5.07x
   *   irs_migration_inflow_households  4.67x
   *   census_* (9 metrics)             1.00x
   *
   * The worst case is the one to quote. 4.67x was the first number measured
   * and it is the one that got repeated; net migration is a difference, so
   * per-ZIP summing amplifies it differently and lands almost three times
   * further out. A change here is a BREAKING CHANGE for every site that sums.
   */
  metricResolutions: { metric: string; resolutions: string[]; ambiguous: boolean }[];

  /**
   * Pages every published site must serve, whatever its niche.
   *
   * A different KIND of contract from the ones above, and the difference is
   * what makes it cheap: the rules above must run inside each publisher's
   * build, because only the build sees the text before it ships. This one Head
   * Quarter can check from outside by fetching the URLs — so a new publisher
   * inherits the requirement without implementing anything, and cannot forget
   * a check it never had to write.
   *
   * Each entry lists ALTERNATE paths and passes if any of them answers. A site
   * serving /privacy-policy is not missing a privacy policy, and reporting it
   * as missing would train someone to ignore this list.
   */
  requiredPages: { id: string; label: string; paths: string[]; why: string }[];

  declaredRules: { id: string; rule: string; enforcedBy: string }[];
}

const RULES_VERSION = "3";

/**
 * The trust pages. Measured absence on atmovingservices.com 2026-09-09: all
 * eight candidate paths returned 404, and the sitemap named none of them.
 *
 * Not a style preference. The privacy policy in particular became mandatory
 * the moment GA4 started running on these sites — Google's own Analytics terms
 * require disclosing the collection, and several jurisdictions require it
 * independently. The rest are what separates a site someone stands behind from
 * one that only exists to rank.
 */
const REQUIRED_PAGES: { id: string; label: string; paths: string[]; why: string }[] = [
  {
    id: "privacy",
    label: "Chính sách quyền riêng tư",
    paths: ["/privacy", "/privacy-policy"],
    why: "Bắt buộc từ lúc site chạy GA4: điều khoản của Google Analytics yêu cầu công bố việc thu thập, và nhiều nơi yêu cầu độc lập với Google. Đây là mục duy nhất trong danh sách này có ràng buộc pháp lý.",
  },
  {
    id: "terms",
    label: "Điều khoản sử dụng",
    paths: ["/terms", "/terms-of-service", "/terms-and-conditions"],
    why: "Xác định site chịu trách nhiệm tới đâu với số liệu nó công bố. Với site trình bày dữ liệu liên bang và diễn giải do máy sinh, đó không phải hình thức.",
  },
  {
    id: "about",
    label: "Giới thiệu",
    paths: ["/about", "/about-us"],
    why: "Ai đứng sau site. Một site không có trang này, không có tác giả, không có địa chỉ là hình dạng kinh điển của affiliate mỏng — và đó là thứ đánh giá chất lượng tìm kiếm nhìn vào.",
  },
  {
    id: "contact",
    label: "Liên hệ",
    paths: ["/contact", "/contact-us"],
    why: "Đường để một người thật báo một con số sai. Không có nó thì lỗi dữ liệu chỉ được phát hiện từ bên trong.",
  },
];

/**
 * Facts used to generate the rounding vectors.
 *
 * Fixed and synthetic on purpose. Vectors built from whatever happens to be in
 * the database today would change every collection run, and a conformance
 * suite whose expected results move on their own is a suite nobody can act on.
 */
const VECTOR_FACTS: FactSet = {
  vertical: "moving-services",
  zip: "00000",
  city: "Testville",
  state: "TX",
  county: "Example County",
  mainKeyword: null,
  countyKeyword: null,
  fingerprint: "vectors",
  facts: [
    {
      key: "census_median_home_value_usd",
      label: "median home value",
      value: 808500,
      display: "$808,500",
      unit: "USD",
      scope: "ZIP",
      scopeName: null,
    },
    {
      key: "census_mobility_rate_pct",
      label: "mobility rate",
      value: 22.6,
      display: "22.6%",
      unit: "%",
      scope: "ZIP",
      scopeName: null,
    },
    {
      // A fact whose value is a whole number, present specifically so a vector
      // can pin what happens when text rounds TOWARD it. Without an integer
      // fact in the set the question cannot be asked.
      key: "census_homeownership_rate_pct",
      label: "homeownership rate",
      value: 23,
      display: "23%",
      unit: "%",
      scope: "ZIP",
      scopeName: null,
    },
  ],
};

function vector(text: string, why: string): ConformanceVector {
  // The verdict is MEASURED by running the validator, never asserted here. If
  // the validator changes, the published vectors change with it — which is the
  // whole point: a site checking against them is checking against behaviour,
  // not against a description of behaviour that may already be out of date.
  const result = validateGeneratedText(text, VECTOR_FACTS);
  return {
    expect: result.passed ? "accept" : "reject",
    text,
    facts: VECTOR_FACTS.facts.map((f) => ({
      key: f.key,
      value: f.value,
      display: f.display,
      unit: f.unit,
      scope: f.scope,
      scopeName: f.scopeName,
    })),
    why,
  };
}

export async function buildContentRules(): Promise<ContentRules> {
  const points = await prisma.dataPoint.groupBy({
    by: ["metric", "resolvedAtResolution"],
  });
  const byMetric = new Map<string, Set<string>>();
  for (const p of points) {
    const set = byMetric.get(p.metric) ?? new Set<string>();
    set.add(p.resolvedAtResolution);
    byMetric.set(p.metric, set);
  }

  return {
    version: RULES_VERSION,
    generatedAt: new Date().toISOString(),

    rounding: {
      policy: "displayed-only",
      description:
        "Một con số trong bài chỉ hợp lệ khi nó bằng ĐÚNG giá trị đo, hoặc bằng ĐÚNG giá trị mà prompt đã in ra (trường display), hoặc một dạng đổi thang của hai giá trị đó (nghìn/triệu/tỷ). Không có cửa sổ dung sai nào. Một con số bị làm tròn lần thứ hai, bởi model chứ không phải bởi pipeline, là một con số mà xuất xứ dừng ở model.",
      vectors: [
        vector(
          "Homes here carry a median value of $808,500.",
          "Giá trị đo nguyên vẹn.",
        ),
        vector(
          "Median home value sits near $809,000.",
          "Model tự làm tròn lần nữa — không phải giá trị đo, cũng không phải mức prompt đã in.",
        ),
        vector(
          "Median home value is about $812,000.",
          "Nằm trong 0.5% của giá trị đo. Luật CŨ chấp nhận, luật hiện tại từ chối.",
        ),
        vector(
          "22.6% of residents lived elsewhere a year ago.",
          "Trích đúng chuỗi prompt đã in.",
        ),
        vector(
          "23% of residents lived elsewhere a year ago.",
          "Trùng khớp fact tỷ lệ sở hữu nhà (23%) — chấp nhận vì nó bằng ĐÚNG một fact, không phải vì nó gần 22.6%.",
        ),
        vector(
          "23.4% of residents lived elsewhere a year ago.",
          "Văn bản làm tròn về phía một fact nguyên (23). Câu hỏi do site đặt ra: một allowance kiểu Math.round ở PHÍA VĂN BẢN có hợp lệ không. Verdict đo được ở đây là câu trả lời.",
        ),
        vector(
          "7.75% of residents lived elsewhere a year ago.",
          "HAI phép làm tròn gặp nhau ở giữa: 7.75 không nằm trong danh sách cho phép của fact nào, nhưng Math.round(7.75)=8 và 8 cũng là Math.round của một fact khác. Không phép làm tròn nào một mình cho nó qua — chỉ hai cái cộng lại. Site đo được 3/119 đoạn đang sống nhờ đúng lỗ này.",
        ),
      ],
    },

    reservedTerms: listReservedTerms(),

    metricResolutions: [...byMetric.entries()]
      .map(([metric, set]) => ({
        metric,
        resolutions: [...set].sort(),
        // A metric appearing at more than one resolution cannot be summed by
        // any single rule. Flagged rather than averaged away — a consumer must
        // decide, and cannot decide what it was never told.
        ambiguous: set.size > 1,
      }))
      .sort((a, b) => a.metric.localeCompare(b.metric)),

    requiredPages: REQUIRED_PAGES,

    declaredRules: [
      {
        id: "scope-disclosure",
        rule: "Số liệu đo ở cấp hạt hoặc bang, khi gán cho một zip, phải nói rõ phạm vi đó trong chính câu chứa nó. Nếu nguồn không có tên địa danh thì dùng 'the county containing ZIP xxxxx', không được bịa tên.",
        enforcedBy: "lib/ai/validate.ts — scope_overclaim, invented_place_name",
      },
      {
        id: "worded-proportion",
        rule: "Mọi tỷ lệ viết bằng chữ ('một phần ba', 'hơn một nửa') phải khớp một con số đo được. Một phân số nghe hợp lý cạnh một tỷ lệ thật là cách sai khó thấy nhất.",
        enforcedBy: "lib/ai/validate.ts — worded_proportion",
      },
      {
        id: "no-supply-side-bridge",
        rule: "Không được bắc cầu từ một con số sang khẳng định về phía cung ('nhiều việc chuyển nhà', 'nhu cầu thợ cao'). Áp cho MỌI con số và MỌI ngành, không chỉ ngành gốc của con số.",
        enforcedBy: "lib/ai/generate.ts",
      },
      {
        id: "aggregate-must-declare-scope",
        rule: "Một con số gộp qua nhiều địa bàn phải in kèm, ngay cạnh nó: phép tính đã dùng, SỐ LƯỢNG geography góp vào, danh từ chỉ phạm vi, và nguồn — và phải vào cả measurementTechnique trong JSON-LD. Phải key theo đúng resolution của metric: cộng một metric cấp COUNTY theo từng ZIP nhân lên tới 13.07x (đo được, irs_migration_net_households). Phần 'số lượng geography' không phải trang trí — nó là thứ cho người đọc kiểm được phép cộng.",
        enforcedBy: "phía site — HQ không sinh số gộp",
      },
      {
        id: "cluster-no-zip-anchor",
        rule: "Trên trang cụm, một đoạn chỉ trích số cấp county bị TỪ CHỐI. Số county giống nhau ở mọi ZIP trong cụm nên đoạn đó nói y hệt trên mọi trang của cụm — thin content mặc áo khác. Đoạn phải chạm ít nhất một figure cấp ZIP. KHÁC scope_overclaim: ở đây phạm vi được nói ĐÚNG, cái thiếu là bất cứ điều gì riêng của ZIP.",
        enforcedBy: "phía site — lib/content/validate.ts",
      },
      {
        id: "no-price-claims",
        rule: "Không nêu giá, ước giá, khoảng giá hay bảng giá dịch vụ. HQ có CPC, không có giá — mọi con số tiền trong bài về chi phí dịch vụ đều là bịa. KHÁC no-supply-side-bridge: cái kia chặn bắc cầu từ một số sang khẳng định phía cung; cái này chặn nêu giá trực tiếp, kể cả khi không bắc cầu từ đâu.",
        enforcedBy: "phía site — 4 luật price-*",
      },
      {
        id: "stay-in-trade",
        rule: "Đoạn viết cho một ngành không được nói như ngành khác, không hứa bảo hành, không mô tả dịch vụ định kỳ nếu ngành đó không phải vậy. Bắt prompt drift giữa các vertical dùng chung template.",
        enforcedBy: "phía site — niche-other-trade, niche-warranty, niche-routine-service",
      },
    ],
  };
}
