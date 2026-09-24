/**
 * Trang của site KHÔNG địa lý gồm những mục nào, và mỗi mục được nói gì.
 *
 * ═══ VÌ SAO LÀ KIỂU RIÊNG, KHÔNG PHẢI THÊM TRƯỜNG VÀO `NicheContentSpec` ═══
 *
 * Cùng lý lẽ đã chọn ở tầng danh tính (xem `EntityIdentity`): hai trục mô tả
 * hai tập trang KHÁC NHAU, nên gộp chúng vào một kiểu sẽ tạo ra một kiểu mà
 * nửa số trường luôn null ở mỗi lần dùng. `NicheContentSpec` có `cluster`,
 * `market`, `stateHub` — ba khối gắn chặt với ZIP/hạt/bang. Một đặc tả bóng
 * đá khai ba khối đó bằng null rồi thêm ba khối mới bên cạnh là một kiểu nói
 * dối về chính nó, và `Scope = "ZIP" | "COUNTY" | "STATE"` thì không có nghĩa
 * nào đúng cho "đội".
 *
 * Quan trọng hơn: `buildSpecSections` bên publisher đọc `sections` của trang
 * ZIP. Một mục `scope: "TEAM"` lọt vào danh sách đó sẽ được trang ZIP đọc
 * trúng — đúng cái bẫy mà chú thích của `NicheClusterSpec` đã ghi ra khi
 * người ta định thêm `scope: "CLUSTER"` vào enum cũ.
 *
 * ═══ CÁI GIÁ, VÀ CHỖ NÓ ĐƯỢC CANH ═══
 *
 * Hai đặc tả nghĩa là hai nơi có thể trôi lệch. Chỗ canh là
 * `scripts/verify-entity-spec.ts`: nó KHÔNG so đặc tả với một danh sách viết
 * tay, mà chạy tầng chỉ số trên dữ liệu THẬT rồi đòi mọi chỉ số đặc tả nhắc
 * tới phải có mặt trong tập chỉ số thực sự phát ra. Đặc tả đòi một chỉ số
 * không ai phát thì mục đó sẽ không bao giờ render, và im lặng — đúng hỏng
 * mà mục `metrics` của bảng niche-readiness sinh ra để bắt.
 */

/**
 * Phạm vi của các con số trong một mục.
 *
 * Không phải siêu dữ liệu trang trí, cùng lý do với `Scope` của trục địa lý:
 * "52,0% số trận có trên 2,5 bàn" là số của GIẢI, và in nó trên trang Arsenal
 * mà không nói rõ là sai phạm vi — y hệt việc gán một con số cấp hạt cho một
 * ZIP. Luật `aggregate-must-declare-scope` không đổi, chỉ đổi từ vựng.
 */
export type EntityScope = "TEAM" | "LEAGUE" | "FIXTURE";

/**
 * Mục này đọc hình dạng dữ liệu nào.
 *
 * `metrics` là mặc định và là thứ duy nhất tồn tại trước 24/9/2026: một tập
 * `FootballFact`, tức con số kèm nhãn.
 *
 * `fixtures` đọc một DANH SÁCH trận chưa đá. Nó phải là loại riêng chứ không
 * gò vào fact, vì một lịch thi đấu không phải con số — gò nó vào sẽ phải bịa
 * những khoá kiểu `next_match_1_home`, và `requires` mất khả năng nói mục này
 * cần gì.
 *
 * ═══ VÌ SAO LOẠI MỤC NÀY ĐƯỢC THÊM ═══
 *
 * Đo cầu tìm kiếm 24/9/2026 (DataForSEO, 2704/vi), so hai nhánh trên CÙNG bộ
 * trang đội:
 *
 *     trang đội là trang SỐ LIỆU   ->   0/78 mẫu có cầu
 *     trang đội là trang LỊCH      ->   lịch thi đấu mu   135.000  KD 0
 *                                       lịch mu            60.500  KD 0
 *                                       lịch thi đấu arsenal 33.100 KD 0
 *
 * Cùng 96 trang, cùng dữ liệu đã có (trận chưa đá nằm sẵn trong file mùa với
 * `fullTime: null`). Khác nhau ở thứ trang trả lời.
 */
export type EntitySectionKind = "metrics" | "fixtures";

export interface EntitySection {
  key: string;
  /** Tiêu đề mục trên trang. Người đọc thấy chuỗi này. */
  heading: string;
  scope: EntityScope;
  /** Thiếu thì coi là `metrics` — mọi mục viết trước 24/9/2026 đều là loại đó. */
  kind?: EntitySectionKind;
  /**
   * Số trận tối đa của mục `fixtures`. Bỏ qua với mục `metrics`.
   *
   * Có giới hạn chứ không in cả mùa: đo 24/9/2026, Ngoại hạng Anh còn **330**
   * trận chưa đá. Một danh sách 330 dòng không trả lời câu "đội này đá trận
   * tới khi nào" — nó chôn câu trả lời xuống dưới màn hình thứ mười.
   */
  fixtureLimit?: number;
  /** Thiếu bất kỳ chỉ số nào ở đây thì KHÔNG render mục. */
  requires: readonly string[];
  /** Nhắc thêm nếu có; thiếu thì mục vẫn render. */
  optional?: readonly string[];
  /**
   * Một câu nói mục này được phép khẳng định điều gì.
   *
   * Viết cho người sẽ đọc lại sau sáu tháng. Nếu không viết được câu này mà
   * không bịa, mục đó không nên tồn tại.
   */
  says: string;
}

export interface EntityFaqEntry {
  key: string;
  /** Chỗ thay: {team} {opponent} {league} {season}. */
  question: string;
  /** Chỗ thay như trên, cộng {metric:tên} thành chuỗi HQ đã định dạng. */
  answer: string;
  /** Danh sách ĐẦY ĐỦ chỉ số câu này cần. Thiếu một cái là bỏ CẢ câu — không
   *  render nửa câu, không viết "dữ liệu chưa có". */
  requires: readonly string[];
}

export interface EntityPageSpec {
  /** Khớp `axis` ở `lib/page-axis/axes.ts`. */
  axis: string;
  /** Chỗ thay: {team} {opponent} {league} {season}. */
  title: string;
  description: string;
  sections: readonly EntitySection[];
  /** Tiêu đề bọc ngoài đoạn diễn giải do AI viết. */
  interpretationHeading: string;
  faq?: { heading: string; entries: readonly EntityFaqEntry[] };
}

export interface EntityContentSpec {
  vertical: string;
  pages: readonly EntityPageSpec[];
  /** Chỉ số tầng chỉ số CÓ phát ra nhưng đặc tả CỐ Ý không dùng, kèm lý do. */
  excluded: readonly { metric: string; why: string }[];
  /**
   * Thứ người đọc MONG THẤY mà không nguồn nào trong tay cung cấp.
   *
   * Khác hẳn `excluded`: bên kia là "có số, không dùng", bên này là "không có
   * số". Hai thứ trông giống nhau khi cùng vắng mặt trên trang, và khác hẳn
   * nhau về việc phải làm tiếp.
   *
   * Danh sách này tồn tại để một session sau KHÔNG lặng lẽ "bổ sung" chúng
   * bằng cách bịa. Đo 22/9/2026 (brief mục 3.1): file trận của openfootball
   * không có người ghi bàn, đội hình, phút thi đấu; kho openfootball/players
   * chỉ có tên, vị trí, chiều cao, ngày sinh — và Việt Nam đúng 1 cầu thủ.
   */
  unavailable: readonly { what: string; why: string }[];
}

const FOOTBALL: EntityContentSpec = {
  vertical: "bong-da-nam",
  pages: [
    {
      axis: "team",
      /**
       * Title dẫn bằng "Lịch thi đấu", không dẫn bằng "Số liệu".
       *
       * Đo 24/9/2026: `lịch thi đấu mu` 135.000 lượt ở KD 0, trong khi MỌI
       * mẫu truy vấn cấp đội về số liệu — `phong độ gần đây của mu`,
       * `thống kê mu mùa này`, `mu thắng mấy trận` — đều không có dữ liệu.
       * Trang vẫn chứa cả hai; title nói thứ người ta đi tìm.
       */
      title: "Lịch thi đấu {team} — {league} {season}",
      description:
        "Lịch thi đấu sắp tới của {team} ở {league} theo giờ Việt Nam, kèm số liệu mùa {season}: " +
        "thứ hạng, phong độ, tách sân nhà và sân khách — và ngày của trận gần nhất đã tính vào.",
      interpretationHeading: "Những con số này cho thấy gì về {team}",
      sections: [
        /**
         * Mục LỊCH đứng ĐẦU, trước mọi mục số liệu.
         *
         * Thứ tự mục là thứ tự đọc, và cầu đo được nằm ở lịch chứ không ở số
         * liệu (xem `EntitySectionKind`). Đặt lịch xuống dưới năm mục số liệu
         * là chôn câu trả lời dưới phần không ai hỏi.
         */
        {
          key: "lich-thi-dau",
          heading: "{team} đá trận tới khi nào",
          scope: "TEAM",
          kind: "fixtures",
          fixtureLimit: 5,
          /**
           * KHÔNG đòi chỉ số nào: mục này đọc danh sách trận, không đọc fact.
           *
           * Nhưng `requires: []` nghĩa là `sectionRenderable()` luôn trả true,
           * nên phía publisher PHẢI tự kiểm danh sách rỗng cho mục
           * `kind: "fixtures"` — mùa đã đá hết thì không còn trận nào, và một
           * tiêu đề "đá trận tới khi nào" trên một danh sách rỗng là tệ hơn
           * không có mục.
           */
          requires: [],
          says:
            "Các trận CHƯA đá của đội này, sớm nhất trước, giờ đã quy về múi giờ Việt Nam. " +
            "Trận nào nguồn không ghi giờ thì nói rõ là chưa có giờ — KHÔNG điền 00:00, cùng " +
            "luật với halfTime null nghĩa là 'không biết'. Đo 24/9/2026: Ngoại hạng Anh đủ giờ " +
            "cho cả 330 trận chưa đá, còn Bundesliga thiếu giờ ở 198/270 trận.",
        },
        {
          key: "standing",
          heading: "{team} đang đứng ở đâu",
          scope: "TEAM",
          requires: ["team_position", "team_points", "team_played"],
          optional: ["team_won", "team_drawn", "team_lost"],
          says:
            "Thứ hạng, điểm và số trận đã đá. Bảng xếp hạng TÍNH TỪ chính các trận đã đá, không lấy " +
            "từ nguồn thứ hai — hai con số cho cùng một sự thật sẽ lệch đúng vào ngày có trận hoãn " +
            "hoặc trừ điểm, tức đúng ngày người ta vào xem.",
        },
        {
          key: "goals",
          heading: "Ghi và thủng lưới",
          scope: "TEAM",
          requires: ["team_goals_for", "team_goals_against"],
          optional: ["team_clean_sheets"],
          says:
            "Bàn ghi, bàn thủng và số trận giữ sạch lưới. Đếm từ tỷ số chung cuộc. KHÔNG được suy ra " +
            "ai ghi bàn hay ghi phút nào: nguồn không có dữ liệu cầu thủ, xem `unavailable`.",
        },
        {
          key: "home-away",
          heading: "Sân nhà và sân khách",
          scope: "TEAM",
          requires: ["team_home_points", "team_home_played", "team_away_points", "team_away_played"],
          says:
            "Điểm giành được ở mỗi sân, kèm số trận đã đá ở sân đó. Số trận ĐI KÈM là bắt buộc: đầu " +
            "mùa hai bên lệch nhau vài trận, nên so điểm trần trụi sẽ nói sai về một đội mới chỉ đá " +
            "một trận sân khách.",
        },
        {
          key: "halves",
          heading: "Bàn thắng theo hiệp",
          scope: "TEAM",
          requires: ["team_known_halves", "team_first_half_goals", "team_second_half_goals"],
          says:
            "Bàn ghi trong hiệp một và hiệp hai, TRÊN MẪU SỐ là số trận biết tỷ số hiệp một — chỉ số " +
            "đó phải hiện ra cùng hai con số kia. Nguồn suy hiệp một từ phút ghi bàn, nên trận không " +
            "bàn nào thì không suy được: đo 22/9/2026 có 17/241 trận thiếu và TẤT CẢ đều là trận 0-0. " +
            "Thiếu nghĩa là KHÔNG BIẾT, không phải 0-0.",
        },
        {
          key: "league-context",
          heading: "So với mặt bằng {league}",
          scope: "LEAGUE",
          requires: ["league_over25_pct", "league_home_win_pct", "league_played"],
          says:
            "Tỷ lệ trận trên 2,5 bàn và tỷ lệ chủ nhà thắng của CẢ GIẢI, đặt cạnh số của đội để có mẫu " +
            "số. Cấp GIẢI — mục phải nói rõ, vì trình bày nó như số của đội là sai phạm vi.",
        },
      ],
      faq: {
        heading: "Câu hỏi thường gặp về {team}",
        entries: [
          {
            key: "vi-tri",
            question: "{team} đang xếp thứ mấy ở {league}?",
            answer:
              "{team} đang đứng hạng {metric:team_position} với {metric:team_points} điểm sau " +
              "{metric:team_played} trận. Bảng xếp hạng này tính từ chính các trận đã đá trong mùa {season}, " +
              "nên nó đổi sau mỗi vòng đấu.",
            requires: ["team_position", "team_points", "team_played"],
          },
          {
            key: "san-nha-san-khach",
            question: "{team} chơi ở sân nhà hay sân khách tốt hơn?",
            answer:
              "{team} giành {metric:team_home_points} điểm qua {metric:team_home_played} trận trên sân nhà, và " +
              "{metric:team_away_points} điểm qua {metric:team_away_played} trận trên sân khách. Số trận ở hai sân " +
              "thường lệch nhau trong giai đoạn đầu mùa, nên hãy đọc điểm cùng với số trận chứ đừng đọc " +
              "riêng điểm.",
            requires: ["team_home_points", "team_home_played", "team_away_points", "team_away_played"],
          },
          {
            key: "ai-ghi-ban",
            // Câu ai cũng hỏi, và KHÔNG có dữ liệu để trả lời. Trả lời thẳng là
            // không có, thay vì im lặng bỏ qua — im lặng để ngỏ chỗ cho một
            // session sau điền vào bằng số bịa.
            question: "Ai là chân sút tốt nhất của {team} mùa này?",
            answer:
              "Trang này không công bố danh sách ghi bàn, vì nguồn dữ liệu đang dùng chỉ có tỷ số từng " +
              "trận — không có người ghi bàn, không có phút ghi bàn, không có đội hình ra sân. Thứ trang " +
              "trả lời được là ở cấp đội: {team} đã ghi {metric:team_goals_for} bàn và thủng " +
              "{metric:team_goals_against} bàn sau {metric:team_played} trận.",
            requires: ["team_goals_for", "team_goals_against", "team_played"],
          },
        ],
      },
    },
    {
      axis: "fixture",
      /**
       * `vs`, KHÔNG phải `gặp` — và đây là chữ đo được, không phải chữ chọn
       * cho thuận tai.
       *
       * Đo 24/9/2026 (DataForSEO, location 2704, language vi):
       *
       *     "đối đầu mu vs liverpool"  ->  0 từ khoá có volume
       *     "mu vs liverpool"          ->  8 từ khoá, cao nhất 1.300
       *     "liverpool vs mu"          ->  40.500
       *
       * Người Việt gõ `vs`. `gặp` và `đối đầu` là tiếng Việt đúng và đọc tự
       * nhiên hơn — nhưng title là chỗ khớp TRUY VẤN, không phải chỗ viết
       * văn. `đối đầu` ở lại trong mô tả và tiêu đề mục, nơi nó mô tả nội
       * dung cho người đọc chứ không gánh việc khớp truy vấn.
       *
       * Thứ tự hai đội cũng đổi lưu lượng — 40.500 so với 1.300 cho CÙNG
       * một cặp — nhưng đó là việc của `fixtureKey()`, không phải của
       * title: title chỉ in ra thứ tự mà khoá đã chọn.
       */
      title: "{team} vs {opponent} — đối đầu ở {league}",
      description:
        "Lịch sử đối đầu giữa {team} và {opponent} ở {league} mùa {season}: số trận, kết quả và bàn " +
        "thắng của mỗi bên, kèm ngày của trận gần nhất đã tính vào.",
      interpretationHeading: "Những lần {team} gặp {opponent} cho thấy gì",
      sections: [
        {
          key: "h2h-record",
          heading: "Thành tích đối đầu",
          scope: "FIXTURE",
          requires: ["h2h_meetings", "h2h_wins_a", "h2h_wins_b", "h2h_draws"],
          says:
            "Số lần hai đội đã gặp nhau trong tập dữ liệu đang có, và kết quả từng bên. Cấp CẶP ĐỐI " +
            "ĐẦU — không được trình bày như phong độ chung của một đội.",
        },
        {
          key: "h2h-goals",
          heading: "Bàn thắng trong các lần gặp nhau",
          scope: "FIXTURE",
          requires: ["h2h_goals_a", "h2h_goals_b"],
          says:
            "Tổng bàn mỗi đội ghi được trong CHÍNH những trận gặp nhau đó. Không phải tổng bàn cả mùa, " +
            "và không được dùng thay cho nhau.",
        },
      ],
      faq: {
        heading: "Câu hỏi thường gặp về cặp {team} - {opponent}",
        entries: [
          {
            key: "doi-dau",
            question: "{team} và {opponent} đã gặp nhau bao nhiêu lần?",
            answer:
              "Trong tập dữ liệu mùa {season}, hai đội đã gặp nhau {metric:h2h_meetings} lần: {team} thắng " +
              "{metric:h2h_wins_a} trận, {opponent} thắng {metric:h2h_wins_b} trận, và {metric:h2h_draws} trận " +
              "kết thúc hoà. Giải đấu vòng tròn hai lượt nên mỗi cặp gặp nhau đúng hai lần mỗi mùa.",
            requires: ["h2h_meetings", "h2h_wins_a", "h2h_wins_b", "h2h_draws"],
          },
        ],
      },
    },
    {
      axis: "league",
      /**
       * Title giữ "bảng xếp hạng" ĐỨNG TRƯỚC, và thêm "lịch thi đấu" sau.
       *
       * Khác trang đội có chủ ý. Ở cấp GIẢI cả hai nhánh đều có cầu đo được
       * 24/9/2026, và bảng xếp hạng lớn hơn:
       *
       *     bxh ngoại hạng anh            246.000  KD 21
       *     lịch thi đấu ngoại hạng anh   550.000  KD 22
       *     lịch ngoại hạng anh           368.000  KD 13
       *
       * Lịch thật ra lớn hơn — nhưng trang này ĐÃ phục vụ bảng xếp hạng và
       * đang là thứ duy nhất trong 977 trang có cầu ánh xạ vững, nên đảo thứ
       * tự title là đổi thứ đang đứng để lấy thứ chưa dựng. Thêm vào, không
       * thay thế.
       */
      title: "{league} {season} — bảng xếp hạng và lịch thi đấu",
      description:
        "Bảng xếp hạng {league} mùa {season} tính từ các trận đã đá, lịch thi đấu sắp tới theo giờ " +
        "Việt Nam, kèm tỷ lệ trận trên 2,5 bàn và tỷ lệ chủ nhà thắng, và ngày của trận gần nhất đã tính vào.",
      interpretationHeading: "Mùa {season} của {league} đang diễn ra thế nào",
      sections: [
        {
          key: "lich-thi-dau",
          heading: "Lịch thi đấu {league} sắp tới",
          scope: "LEAGUE",
          kind: "fixtures",
          /**
           * 10 trận, không phải 5 như trang đội: một vòng đấu có 9–10 trận,
           * nên 5 sẽ cắt ngang vòng và người đọc thấy nửa vòng mà không biết
           * mình đang thấy nửa.
           */
          fixtureLimit: 10,
          requires: [],
          says:
            "Các trận CHƯA đá của giải, sớm nhất trước, giờ đã quy về múi giờ Việt Nam. Cấp GIẢI — " +
            "đây là lịch của toàn giải, không phải của một đội; trang đội có mục riêng.",
        },
        {
          key: "league-shape",
          heading: "Mặt bằng của giải",
          scope: "LEAGUE",
          requires: ["league_played", "league_over25_pct", "league_home_win_pct"],
          says:
            "Số trận đã đá, tỷ lệ trận trên 2,5 bàn và tỷ lệ chủ nhà thắng. Cấp GIẢI. Đây là mẫu số để " +
            "đọc số của từng đội, không phải một dự đoán về trận sắp tới.",
        },
      ],
    },
  ],
  excluded: [
    {
      metric: "team_streak_length",
      why:
        "Không đưa vào MỤC nào ở giai đoạn 1. Một chuỗi chỉ có nghĩa khi kèm loại của nó (thắng / " +
        "bất bại / không thắng), và bốn loại đó cần văn xuôi chứ không cần một ô số. " +
        "`excluded` ở đây nghĩa là KHÔNG CÓ MỤC RIÊNG, không phải giấu khỏi tầng AI: chỉ số vẫn đi " +
        "vào fact set của đoạn diễn giải, và đó đúng là chỗ văn xuôi mà nó cần. Đo 22/9/2026 trên " +
        "trang Chelsea FC, model dùng nó thành chuỗi 3 trận không thắng.",
    },
  ],
  unavailable: [
    {
      what: "Người ghi bàn, phút ghi bàn, kiến tạo",
      why:
        "File trận của openfootball chỉ có vòng, ngày, hai đội và tỷ số hiệp một / chung cuộc. Đo " +
        "22/9/2026, brief mục 3.1.",
    },
    {
      what: "Đội hình ra sân, thay người, thẻ phạt",
      why: "Không có trong nguồn. Cùng phép đo.",
    },
    {
      what: "Kiểm soát bóng, số cú sút, số phạt góc",
      why: "Không có trong nguồn. Đây là dữ liệu nhà cung cấp thương mại, không có bản miễn phí.",
    },
    {
      what: "Phong độ và thống kê CẦU THỦ",
      why:
        "Kho openfootball/players không phải dữ liệu thống kê: mỗi dòng là tên, vị trí, chiều cao, " +
        "ngày và nơi sinh — không CLB, không số trận, không bàn thắng. Anh 3.487 cầu thủ, Việt Nam " +
        "đúng 1. Mọi trang kiểu 'phong độ cầu thủ X 5 trận gần nhất' sẽ phải BỊA nếu dựng từ nguồn " +
        "hiện tại.",
    },
    {
      what: "V.League 1 và mọi giải trong nước Việt Nam",
      why:
        "openfootball không có giải Việt Nam. TheSportsDB trả về Wigan Athletic, Blackpool, Leicester " +
        "làm đội V.League 1 — dữ liệu SAI chứ không phải thiếu, nên không dùng được kể cả để lấp tạm.",
    },
    {
      what: "Lịch thi đấu sắp tới và dự đoán trước trận",
      why:
        "Dữ liệu lịch thì CÓ (file mùa chứa cả 380 trận, trận chưa đá mang fullTime null). Cái chưa có " +
        "là quyết định dùng nó — chủ dự án đã chốt nội dung là nhận định SAU trận, không phải dự đoán " +
        "trước trận (brief mục 4.2).",
    },
  ],
};

const ENTITY_SPECS: readonly EntityContentSpec[] = [FOOTBALL];

export function entitySpecFor(vertical: string): EntityContentSpec | null {
  return ENTITY_SPECS.find((s) => s.vertical === vertical) ?? null;
}

export function allEntitySpecs(): readonly EntityContentSpec[] {
  return ENTITY_SPECS;
}

export function entityPageSpecFor(vertical: string, axis: string): EntityPageSpec | null {
  return entitySpecFor(vertical)?.pages.find((p) => p.axis === axis) ?? null;
}

/** Mọi chỉ số đặc tả có nhắc tới — dùng, tuỳ chọn, hay cố ý bỏ. */
export function metricsNamedByEntity(spec: EntityContentSpec): Set<string> {
  const out = new Set<string>();
  for (const page of spec.pages) {
    for (const s of page.sections) {
      for (const m of s.requires) out.add(m);
      for (const m of s.optional ?? []) out.add(m);
    }
    for (const e of page.faq?.entries ?? []) {
      for (const m of e.requires) out.add(m);
    }
  }
  for (const e of spec.excluded) out.add(e.metric);
  return out;
}
