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
