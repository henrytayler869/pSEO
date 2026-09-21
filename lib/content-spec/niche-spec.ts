/**
 * Trang thị trường của MỘT nghề gồm những mục nào, và mỗi mục được nói gì.
 *
 * ═══ VÌ SAO Ở HQ, KHÔNG Ở REPO PUBLISHER ═══
 *
 * Hôm nay văn xuôi trang ZIP nằm trong publisher: lib/content/narrative.ts,
 * 447 dòng, với các mục `mobility`, `migration`, `housing` gắn chặt nghề
 * chuyển nhà. Publisher thứ hai dùng CÙNG mã đó, nên trang của nó in ra
 * "What a move actually costs…" trên một site về tai nạn giao thông — 90 trang
 * lên production ngày 18/9/2026 trước khi bị chặn bằng noindex.
 *
 * Nguyên nhân không phải mã sai. Nguyên nhân là QUYẾT ĐỊNH NỘI DUNG nằm ở nơi
 * mỗi publisher một bản: thêm nghề thứ hai thì phải sửa mã của site thứ nhất.
 * Đặc tả về HQ thì một nghề mới là một mục dữ liệu, không phải một lần sửa mã.
 *
 * ═══ NỀN CỦA ĐẶC TẢ LÀ THỨ ĐÃ CÓ, KHÔNG PHẢI THỨ MỚI ═══
 *
 * "Dữ liệu nào thuộc về nghề này" ĐÃ có một định nghĩa: DataSource.
 * relevantVerticals, và getRealDataPointsForZipAndVertical đã lọc theo nó.
 * Đo 18/9/2026, fact set của auto-accident-attorney tại ZIP 85225 có đúng 5
 * sự kiện, tất cả từ hai nguồn được khai liên quan. Tầng AI vốn đã đúng nghề.
 *
 * Nên file này KHÔNG định nghĩa lại điều đó. Nó chỉ nói: trong những chỉ số đã
 * được coi là liên quan, mục nào dùng chỉ số nào — và chỉ số nào CỐ Ý không
 * dùng, kèm lý do.
 *
 * ═══ `excluded` LÀ PHẦN QUAN TRỌNG NHẤT ═══
 *
 * Một chỉ số không được nhắc tới trong đặc tả có hai khả năng: ai đó quyết
 * định không dùng, hoặc ai đó quên. Hai thứ đó nhìn giống hệt nhau trong mã,
 * và khác hẳn nhau trong hậu quả. `excluded` buộc phải phân biệt, và
 * scripts/verify-niche-spec.ts đỏ khi có chỉ số rơi ra ngoài cả hai danh sách.
 */

export type Scope = "ZIP" | "COUNTY" | "STATE";

/**
 * Trang CỤM: nhiều ZIP trên một trang, và nó cần chữ riêng.
 *
 * ═══ VÌ SAO KHÔNG DÙNG LẠI `sections` ═══
 *
 * `sections` mô tả trang MỘT ZIP: mỗi mục là một bộ chỉ số của chính ZIP đó.
 * Trang cụm gộp 23 ZIP, nên thứ nó nói được mà trang lẻ không nói nổi là DẢI
 * — và thứ nó KHÔNG nói được là "giá trị ở đây", vì không có "đây".
 *
 * Nên đây là một khối riêng, không phải thêm một scope vào enum cũ. Một mục
 * scope="CLUSTER" nằm chung danh sách sẽ bị buildSpecSections của trang ZIP
 * đọc trúng, và trang ZIP sẽ in một mục nói về dải giữa các ZIP khác.
 *
 * ═══ VÌ SAO Ở HQ ═══
 *
 * Đo 20/9/2026 trên production: 27 trang cụm của theaccidentrecord.com — một
 * site luật sư tai nạn — in meta description "Household migration across Kings
 * County and Census housing estimates…", H2 "Migration across Kings County",
 * và câu dẫn "the only nationwide source that tracks household moves directly".
 * cluster-view.tsx không import gì về niche: mọi chữ của nó là văn xuôi chuyển
 * nhà viết cứng. Nhánh trang ZIP đã được làm niche-aware từ lâu; nhánh cụm
 * chưa bao giờ.
 *
 * Cùng nguyên nhân với lần trước, cùng cách chữa: quyết định nội dung về HQ,
 * publisher chỉ render.
 *
 * ═══ CHỖ THAY ═══
 *
 * Chuỗi đi qua API dưới dạng JSON nên KHÔNG thể là hàm. Ba chỗ thay, và chỉ
 * ba — thêm nữa thì đây thành một ngôn ngữ mẫu, và một ngôn ngữ mẫu không có
 * trình kiểm tra là thứ sẽ in ra "{cuont}" trên trang thật:
 *
 *   {count}     số ZIP trên trang        "23"
 *   {place}     tên nơi đã có phẩm cách  "Brooklyn, NY"
 *   {counties}  hạt, đã nối bằng "and"   "Kings County"
 */
export interface NicheClusterSpec {
  /** Meta description. Chỉ được nhắc thứ trang thật sự in ra. */
  description: string;
  /** Mục bảng so sánh từng ZIP. */
  comparison: { heading: string; lead: string };
  /** Mục số liệu cấp hạt. `headingMulti` dùng khi cụm trải nhiều hạt. */
  county: { heading: string; headingMulti: string; lead: string };
  /**
   * Ô thống kê ở đầu trang, theo chỉ số.
   *
   * Chỉ số vắng mặt thì KHÔNG render ô đó — không có ô "—". Một ô trống nói
   * "chúng tôi định đo cái này nhưng không có", và đó là câu không trang nào
   * cần nói.
   */
  tiles: readonly { metric: string; label: string }[];
  /** Loại số liệu phân biệt các ZIP với nhau, dùng trong câu "vì sao một
   *  trang thay vì nhiều trang". Danh từ, ghép được vào giữa câu. */
  distinguishing: string;
  /** Tiêu đề mục liệt kê trang trụ. */
  topicsHeading: string;
}

/**
 * Trang MỘT ZIP: hai chuỗi mà `sections` không mô tả nổi.
 *
 * `sections` nói mỗi mục dùng chỉ số nào. Nó không nói meta description của
 * trang, cũng không nói tiêu đề bọc ngoài đoạn diễn giải AI — hai thứ đó là
 * văn xuôi thuần, và chúng đã nằm trong mã publisher từ đầu.
 *
 * Đo 20/9/2026 trên /auto-accident-attorney/nv/las-vegas-89108, sau khi nhánh
 * CỤM đã sạch:
 *
 *   meta  "Federal migration and housing data for ZIP 89108 in Las Vegas, NV"
 *   H2    "What this means for a move in Las Vegas"
 *
 * Meta description là chuỗi Google in dưới tiêu đề trong kết quả tìm kiếm,
 * nên đây là chỗ rò dễ thấy nhất với người thật. 63 trang.
 *
 * Chỗ thay: {zip} {place} {detail}.
 */
export interface NicheMarketSpec {
  /**
   * Chỉ số mở đầu mô tả, theo thứ tự.
   *
   * Mô tả dẫn bằng con số PHÂN BIỆT trang này với mọi trang khác của site,
   * thay vì lặp lại tiêu đề. Publisher từng ghim cứng hai chỉ số cho việc đó
   * — irs_migration_net_households và census_median_home_value_usd — nên với
   * nghề không có hai chỉ số ấy, câu dẫn lặng lẽ rỗng và mọi trang dùng chung
   * một mô tả không phân biệt gì.
   *
   * `phrase` có đúng một chỗ thay: {display} — chuỗi HQ đã định dạng sẵn, thứ
   * trang in ra nguyên văn. Không dựng lại số ở đây: hai nơi định dạng một
   * con số là hai câu trả lời cho một câu hỏi.
   */
  leadMetrics: readonly { metric: string; phrase: string }[];
  /** Meta khi trang không có câu dẫn riêng. */
  description: string;
  /** Meta khi có — `{detail}` là câu dẫn đó, đặt lên đầu. */
  descriptionWithDetail: string;
  /** Tiêu đề mục chứa đoạn diễn giải AI. */
  interpretationHeading: string;
}

/**
 * FAQ của nghề — câu hỏi, và cách dựng câu trả lời TỪ CHÍNH FACT.
 *
 * Publisher CỐ Ý không render FAQ cho nghề đi đường spec: `const faq =
 * handWritten ? deterministicFaq : []`. Quyết định đó đúng — bộ FAQ viết cứng
 * là của nghề chuyển nhà, và một câu hỏi sai nghề lọt vào `FAQPage` còn tệ hơn
 * không có câu nào, vì nó là thứ Google trích thẳng lên trang kết quả.
 *
 * Hệ quả: 63 trang ZIP của site tai nạn không có khối FAQ nào và không có
 * `FAQPage` nào, trong khi site chuyển nhà có 5 câu. Chỗ thiếu không phải ở
 * publisher — publisher không được phép đoán về nghề. Chỗ thiếu là đặc tả
 * chưa nói.
 *
 * ═══ CÂU TRẢ LỜI DỰNG TỪ FACT, KHÔNG PHẢI VĂN VIẾT SẴN ═══
 *
 * `{metric:tên_chỉ_số}` được thay bằng chuỗi HQ đã định dạng cho chỉ số đó
 * trên chính ZIP đang render. Nên câu trả lời mang số THẬT của nơi đó, và
 * không có đường nào để một con số bịa lọt vào: chỉ số không có trong fact set
 * thì câu đó KHÔNG render.
 *
 * `requires` là danh sách đầy đủ chỉ số câu này cần. Thiếu một cái là bỏ cả
 * câu — không render nửa câu, không viết "dữ liệu chưa có".
 */
export interface NicheFaqEntry {
  key: string;
  /** Chỗ thay: {place} {zip} {county}. */
  question: string;
  /** Chỗ thay như trên, cộng {metric:tên} -> giá trị đã định dạng. */
  answer: string;
  requires: readonly string[];
}

export interface NicheSection {
  key: string;
  /** Tiêu đề mục trên trang. Người đọc thấy chuỗi này. */
  heading: string;
  /**
   * Độ phân giải địa lý của các con số trong mục.
   *
   * Không phải siêu dữ liệu trang trí: một con số cấp HẠT trình bày như số của
   * một ZIP là sai phạm vi, và đó là luật `aggregate-must-declare-scope` mà HQ
   * đã công bố. Mục phải tự nói ra phạm vi của nó.
   */
  scope: Scope;
  /** Thiếu bất kỳ chỉ số nào ở đây thì KHÔNG render mục. */
  requires: readonly string[];
  /** Nhắc thêm nếu có; thiếu thì mục vẫn render. */
  optional?: readonly string[];
  /**
   * Một câu nói mục này được phép khẳng định điều gì.
   *
   * Viết cho người sẽ đọc lại đặc tả sau sáu tháng, không phải cho máy. Nếu
   * không viết được câu này mà không bịa, mục đó không nên tồn tại.
   */
  says: string;
}

export interface NicheContentSpec {
  vertical: string;
  sections: readonly NicheSection[];
  /**
   * Chữ cho trang cụm. Vắng mặt = nghề này KHÔNG được dựng trang cụm có chữ
   * riêng; publisher sẽ chỉ render phần trung tính. Không có đường rơi về chữ
   * của nghề khác — chính cái fallback ấy là thứ đã cho 90 trang tai nạn nói
   * về chuyển nhà.
   */
  cluster?: NicheClusterSpec;
  /** Chữ cho trang một ZIP. Vắng mặt = publisher dùng chữ trung tính. */
  market?: NicheMarketSpec;
  /**
   * FAQ của nghề. Vắng mặt = trang KHÔNG có khối FAQ và KHÔNG có FAQPage —
   * chứ không rơi về FAQ của nghề khác.
   *
   * Nghề đã có FAQ viết tay trong publisher (moving-services) thì KHÔNG khai ở
   * đây: hai nguồn cho cùng một khối là hai bộ câu hỏi sẽ lệch nhau, và bản
   * viết tay đang chạy tốt với 5 câu.
   */
  faq?: {
    /**
     * Tiêu đề mục FAQ trên trang.
     *
     * Gói CHUNG với `entries` chứ không để rời, và đó là khác biệt có giá:
     * publisher viết cứng "Questions about moving in this area" cho mục này.
     * Chuỗi đó vô hại suốt thời gian nghề tai nạn KHÔNG có FAQ — mục không
     * render nên không ai thấy. Vừa cấp FAQ cho nó là 63 trang in ngay tiêu
     * đề nghề chuyển nhà, và cổng verify:rendered bắt được trước khi lên
     * production.
     *
     * Để `heading` rời thành trường optional thì một nghề khai `entries` mà
     * quên `heading` sẽ rơi lại đúng chuỗi viết cứng đó. Gói chung thì kiểu dữ
     * liệu không cho phép quên.
     */
    heading: string;
    entries: readonly NicheFaqEntry[];
  };
  /** Chỉ số thuộc nguồn liên quan nhưng CỐ Ý không dùng, kèm lý do. */
  excluded: readonly { metric: string; why: string }[];
}

const MOVING: NicheContentSpec = {
  vertical: "moving-services",
  sections: [
    {
      key: "mobility",
      heading: "How often people move here",
      scope: "ZIP",
      requires: ["census_mobility_rate_pct", "census_moved_within_county"],
      optional: ["census_moved_from_different_county", "census_moved_from_different_state", "census_moved_from_abroad"],
      says:
        "Bao nhiêu phần trăm cư dân đổi địa chỉ trong năm, và trong số đó bao nhiêu là chuyển trong cùng hạt " +
        "so với đến từ nơi khác. Census hỏi thẳng cư dân năm ngoái sống ở đâu, nên đây là số đếm, không phải ước lượng.",
    },
    {
      key: "migration",
      heading: "Households moving in and out",
      scope: "COUNTY",
      requires: ["irs_migration_inflow_households", "irs_migration_outflow_households"],
      optional: ["irs_migration_net_households", "irs_migration_inflow_agi_usd"],
      says:
        "Số hộ chuyển vào và chuyển ra, đếm bằng cách so địa chỉ trên hai tờ khai thuế liên tiếp. " +
        "Cấp HẠT — mục phải nói rõ, vì gán cho một ZIP là sai phạm vi.",
    },
    {
      key: "housing",
      heading: "What the housing stock looks like",
      scope: "ZIP",
      requires: ["census_homeownership_rate_pct", "census_median_year_built"],
      optional: ["census_median_home_value_usd", "census_median_household_income_usd"],
      says:
        "Tỷ lệ sở hữu nhà và tuổi nhà trung vị — hai thứ đổi khối lượng một cuộc chuyển nhà. " +
        "KHÔNG suy ra giá dịch vụ từ đây: không nguồn nào trong hệ này đo giá.",
    },
  ],
  cluster: {
    // Nguyên văn những chuỗi cluster-view đang in, chuyển từ mã sang dữ liệu.
    // Site chuyển nhà phải KHÔNG đổi một ký tự nào sau lần này.
    description:
      "Household migration across {counties} and Census housing estimates for {count} {place} ZIP codes, " +
      "side by side, with the source and collection date for every figure.",
    comparison: {
      heading: "How these {count} ZIP codes differ",
      lead:
        "Census Bureau five-year estimates, measured for each ZIP code individually — including how many of " +
        "its residents moved in the past year.",
    },
    county: {
      heading: "Migration across {counties}",
      headingMulti: "Migration, county by county",
      lead:
        "Counted from federal tax returns — the only nationwide source that tracks household moves directly. " +
        "These figures cover whole counties, not any single ZIP code above.",
    },
    tiles: [
      { metric: "irs_migration_inflow_households", label: "Households in/yr" },
      { metric: "irs_migration_outflow_households", label: "Households out/yr" },
      { metric: "irs_migration_net_households", label: "Net households/yr" },
    ],
    distinguishing: "housing and mobility estimates",
    topicsHeading: "By kind of move",
  },
  market: {
    // Nguyên văn thứ publisher đang in cho nghề này.
    leadMetrics: [
      { metric: "irs_migration_net_households", phrase: "Net household migration {display} a year countywide" },
      { metric: "census_median_home_value_usd", phrase: "median home value {display}" },
    ],
    description:
      "Federal migration and housing data for ZIP {zip} in {place}, with the source and collection date for every figure.",
    descriptionWithDetail:
      "{detail}. Federal migration and housing data for ZIP {zip}, with the source and collection date for every figure.",
    interpretationHeading: "What this means for a move in {place}",
  },
  excluded: [],
};

const AUTO_ACCIDENT: NicheContentSpec = {
  vertical: "auto-accident-attorney",
  sections: [
    {
      key: "crash-exposure",
      heading: "Fatal crashes recorded in this county",
      scope: "COUNTY",
      requires: ["fars_fatal_crashes_1yr", "fars_fatalities_1yr"],
      says:
        "Số VỤ tai nạn có người chết và số NGƯỜI chết trong các vụ đó, trong một năm. Hai con số khác nhau " +
        "và một vụ giết được nhiều người — không được dùng thay cho nhau. FARS chỉ đếm vụ CÓ NGƯỜI CHẾT, " +
        "nên không được viết thành 'số vụ tai nạn'. Cấp HẠT, mục phải nói rõ.",
    },
    {
      key: "commute-exposure",
      heading: "How people get to work here",
      scope: "ZIP",
      requires: ["commute_workers_total", "commute_car_share_pct"],
      optional: ["commute_60min_plus_pct"],
      says:
        "Bao nhiêu cư dân đi làm và bao nhiêu phần trăm trong số đó đi bằng ô tô — mức phơi nhiễm mà " +
        "những con số tai nạn ở trên đặt lên. KHÔNG được nói mức phơi nhiễm GÂY RA tai nạn: " +
        "không dữ liệu nào ở đây đo quan hệ đó.",
    },
  ],
  cluster: {
    // Chỉ nhắc thứ nghề này THẬT SỰ có: FARS cấp hạt, và cách đi làm cấp ZIP.
    // Không có "migration", không có "housing" — hai chữ đó không mô tả gì
    // trên một site về tai nạn giao thông.
    description:
      "Fatal crashes recorded across {counties} and how people get to work in {count} {place} ZIP codes, " +
      "side by side, with the source and collection date for every figure.",
    comparison: {
      heading: "How these {count} ZIP codes differ",
      lead:
        "Census Bureau five-year estimates of how residents of each ZIP code get to work — the exposure the " +
        "county crash figures below sit on top of. Measured for each ZIP code individually.",
    },
    county: {
      heading: "Fatal crashes recorded across {counties}",
      headingMulti: "Fatal crashes, county by county",
      lead:
        "Counted by NHTSA from police reports of crashes in which someone died. These are crashes with a " +
        "fatality, not all crashes, and the figures cover whole counties — not any single ZIP code above.",
    },
    tiles: [
      { metric: "fars_fatal_crashes_1yr", label: "Fatal crashes/yr" },
      { metric: "fars_fatalities_1yr", label: "People killed/yr" },
    ],
    distinguishing: "commuting estimates",
    topicsHeading: "By kind of exposure",
  },
  market: {
    leadMetrics: [
      { metric: "fars_fatal_crashes_1yr", phrase: "{display} fatal crashes a year countywide" },
      { metric: "commute_car_share_pct", phrase: "{display} of workers drive to work" },
    ],
    description:
      "Fatal crashes recorded in the county containing ZIP {zip} in {place}, and how residents get to work, with the source and collection date for every figure.",
    descriptionWithDetail:
      "{detail}. Fatal crashes recorded in the county containing ZIP {zip}, and how residents get to work, with the source and collection date for every figure.",
    // KHÔNG "what this means for you": trang không biết người đọc là ai, và
    // một lời hứa tư vấn trên trang chỉ có số liệu là lời hứa không giữ được.
    interpretationHeading: "What these figures show for {place}",
  },
  faq: {
    heading: "Questions about crash data in this area",
    entries: [
      {
        key: "fatal-crashes",
        question: "How many fatal crashes happen around {place}?",
        answer:
          "NHTSA's Fatality Analysis Reporting System records {metric:fars_fatal_crashes_1yr} in {county} " +
          "in a year, in which {metric:fars_fatalities_1yr} died. Those two figures are different and one " +
          "crash can kill more than one person. FARS counts only crashes in which someone died — it is not " +
          "a count of all crashes — and it is published per county, so it describes {county} rather than " +
          "ZIP {zip} on its own.",
        requires: ["fars_fatal_crashes_1yr", "fars_fatalities_1yr"],
      },
      {
        key: "road-exposure",
        question: "How much driving do people in ZIP {zip} actually do?",
        answer:
          "Census Bureau five-year estimates put {metric:commute_workers_total} travelling to work from " +
          "ZIP {zip}, and {metric:commute_car_share_pct} of them drive. That is the exposure the county " +
          "crash figures sit on top of — more drivers on the road for more hours is more opportunity for " +
          "a collision. It does NOT mean commuting causes crashes: nothing in this data measures that.",
        requires: ["commute_workers_total", "commute_car_share_pct"],
      },
      {
        key: "long-commutes",
        question: "Do people here spend long stretches on the road?",
        answer:
          "{metric:commute_60min_plus_pct} of workers in ZIP {zip} spend an hour or more getting to work " +
          "each way. Long commutes mean highway miles and driving at the start and end of the day, which " +
          "is when the roads are busiest — but this figure describes time spent travelling, not risk, and " +
          "no source here links the two.",
        requires: ["commute_60min_plus_pct"],
      },
      {
        key: "what-is-a-claim-worth",
        // Câu tương đương "chuyển nhà hết bao nhiêu tiền" của nghề kia: đúng ý
        // định người tìm, và KHÔNG có dữ liệu để trả lời. Bịa một khoảng tiền ở
        // đây là cách dễ nhất để phá §7.1, và là thứ gần như mọi trang trong
        // nghề này đang làm.
        question: "What is a car accident claim worth in {place}?",
        answer:
          "This page does not publish a settlement figure, because no federal dataset reports what claims " +
          "settle for, and a made-up range would not help you. What it does give you is the public record " +
          "for the place itself: {metric:fars_fatal_crashes_1yr} in {county} in a year, and " +
          "{metric:commute_car_share_pct} of local workers driving to work. What a specific claim is worth " +
          "depends on the crash, the injuries and the policy limits — take those to a lawyer licensed in " +
          "the state, not to a page of statistics.",
        requires: ["fars_fatal_crashes_1yr", "commute_car_share_pct"],
        },
    ],
  },
  excluded: [],
};

const SPECS: readonly NicheContentSpec[] = [MOVING, AUTO_ACCIDENT];

export function specFor(vertical: string): NicheContentSpec | null {
  return SPECS.find((s) => s.vertical === vertical) ?? null;
}

export function allSpecs(): readonly NicheContentSpec[] {
  return SPECS;
}

/** Mọi chỉ số mà đặc tả có nhắc tới — dùng hay cố ý bỏ. */
export function metricsNamedBy(spec: NicheContentSpec): Set<string> {
  const out = new Set<string>();
  for (const s of spec.sections) {
    for (const m of s.requires) out.add(m);
    for (const m of s.optional ?? []) out.add(m);
  }
  for (const e of spec.excluded) out.add(e.metric);
  return out;
}
