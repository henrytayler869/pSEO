/**
 * Thị trường tìm kiếm của một nghề: vùng, ngôn ngữ, và TỪ KHOÁ MỒI.
 *
 * ═══ VÌ SAO KHÔNG SUY TỪ SLUG ═══
 *
 * `related-keywords.ts` trước đây dựng mồi bằng `vertical.replace(/-/g, " ")`.
 * Đúng cho nghề Mỹ: `moving-services` -> `"moving services"`, một truy vấn
 * người thật gõ. SAI HOÀN TOÀN cho nghề Việt:
 *
 *     bong-da-nam  ->  "bong da nam"
 *
 * Không dấu, không ai gõ thế, và DataForSEO sẽ trả về một tập từ khoá của
 * một truy vấn không tồn tại. Nguy ở chỗ nó KHÔNG lỗi — nó trả về dữ liệu
 * trông hợp lệ, có volume, có CPC, và mọi tầng sau coi đó là cầu tìm kiếm
 * thật.
 *
 * Nên mồi phải KHAI TAY, có dấu, và là truy vấn người Việt thật sự gõ.
 *
 * ═══ VÌ SAO NHIỀU MỒI, KHÔNG PHẢI MỘT ═══
 *
 * Một mồi trả về vùng lân cận ngữ nghĩa của CHÍNH nó. Câu hỏi đang mở —
 * "người Việt có tìm theo cặp đối đầu không" — không trả lời được bằng một
 * mồi, vì nếu mồi chọn sai nhánh thì kết quả rỗng đọc như "không có cầu"
 * trong khi thật ra là "hỏi sai chỗ".
 *
 * Mồi dưới đây cố tình rải trên NHIỀU nhánh của cùng chủ đề: kết quả, bảng
 * xếp hạng, cặp đấu, lịch thi đấu, nhận định, và tên đội. Nhánh nào rỗng thì
 * đó là dữ liệu về nhánh đó, không phải về cả chủ đề.
 *
 * ═══ MỒI TRẢ 0 Ở LẠI, KHÔNG BỊ XOÁ ═══
 *
 * Đo 24/9/2026 đã trả tiền để học đúng một bài: `"đối đầu mu vs liverpool"`
 * trả **0** trong khi `"mu vs liverpool"` trả 8 từ khoá. Nếu chỉ giữ mồi
 * thắng thì lần sau không ai thấy vì sao nó thắng, và "đối đầu" — cái tên
 * trục đang dùng trong `entity-spec` — sẽ lại trông như một lựa chọn vô hại.
 *
 * Nên hai mồi đó nằm CẠNH NHAU, và mồi thua có chú thích riêng. Một registry
 * chỉ chứa câu trả lời đúng là một registry không dạy được gì.
 */
export interface KeywordMarket {
  /** location_code của DataForSEO. 2840 = Hoa Kỳ, 2704 = Việt Nam. */
  locationCode: number;
  /** language_code của DataForSEO. */
  languageCode: string;
  /** Từ khoá mồi, KHAI TAY. Xem ghi chú trên. */
  seeds: readonly string[];
}

const US: KeywordMarket = { locationCode: 2840, languageCode: "en", seeds: [] };

const MARKETS: Record<string, KeywordMarket> = {
  "bong-da-nam": {
    locationCode: 2704,
    languageCode: "vi",
    seeds: [
      // nhánh KẾT QUẢ
      "kết quả bóng đá",
      // nhánh BẢNG XẾP HẠNG
      "bảng xếp hạng ngoại hạng anh",

      /**
       * ĐỐI CHỨNG ÂM — giữ lại CÓ CHỦ Ý, đừng xoá vì nó trả 0.
       *
       * Đo 24/9/2026: mồi này trả về **0 từ khoá có volume**, trong khi
       * `"mu vs liverpool"` ngay dưới trả 8 từ khoá. Cùng một ý, hai cách
       * gọi, một bên rỗng — "đối đầu" KHÔNG phải từ người Việt gõ.
       *
       * Lần đo đầu chỉ chạy đúng mồi này, được 0, và suýt kết luận "trục
       * đối đầu không có cầu" — tức suýt khai tử 876/977 trang của site
       * bằng một phép thử âm chỉ bác được chính nó. Cặp mồi này ở lại cạnh
       * nhau để lần sau không ai phải học lại bài đó bằng tiền.
       */
      "đối đầu mu vs liverpool",
      // nhánh CẶP ĐẤU, bằng đúng chữ người dùng gõ. 8 từ khoá, cao nhất
      // 1.300 — và `liverpool vs mu` (thứ tự ngược) là 40.500.
      "mu vs liverpool",

      /**
       * Hai nhánh LỚN NHẤT mọi đợt đo, và site chưa phục vụ nhánh nào.
       *
       * Khai ở đây để lần đo sau còn thấy chúng, chứ KHÔNG phải vì đã chốt
       * đuổi theo. `nhận định` phần lớn là soi kèo — validator của site cấm
       * từ vựng đó và doanh thu banner không sống chung với nội dung cờ
       * bạc, nên nhánh 673.000 ấy là thứ đo để BIẾT, không phải để nhắm.
       */
      "lịch thi đấu bóng đá",
      "nhận định mu vs liverpool",

      /**
       * Tên đội: đo xem người Việt gõ tên nào.
       *
       * `manchester united` -> cao nhất `lịch thi đấu mu` 135.000.
       * `tottenham hotspur` -> **0**, mà đó là CLB lớn — nên 0 ở đây nói về
       * CÁI TÊN, không nói về đội. 96 trang đội đang mang tên openfootball.
       */
      "manchester united",
      "bayern munich",
      "tottenham hotspur",
    ],
  },
};

/**
 * Thị trường của một nghề. Nghề chưa khai thì rơi về Hoa Kỳ/tiếng Anh với
 * mồi suy từ slug — giữ nguyên hành vi cũ cho 13 nghề Mỹ.
 */
export function marketFor(vertical: string): KeywordMarket {
  const m = MARKETS[vertical];
  if (m) return m;
  return { ...US, seeds: [vertical.replace(/-/g, " ")] };
}

export function hasExplicitMarket(vertical: string): boolean {
  return vertical in MARKETS;
}

/**
 * Mọi nghề có khai thị trường riêng.
 *
 * Tồn tại cho cổng canh: `verify-keyword-markets.ts` cần duyệt TỪNG nghề để
 * hỏi "mồi của nghề này có phải chuỗi suy từ slug không". Trước đó nó viết
 * cứng đúng một chuỗi — `"bong da nam"` — nên nghề Việt thứ hai khai mồi suy
 * từ slug sẽ đi qua cổng sạch sẽ.
 *
 * Đọc từ `MARKETS` chứ không khai lại: một danh sách viết tay ở cổng là định
 * nghĩa thứ hai, và nó sẽ trôi lệch đúng vào ngày có người thêm nghề mới —
 * tức đúng ngày cổng cần đúng nhất.
 */
export function verticalsWithExplicitMarket(): string[] {
  return Object.keys(MARKETS).sort();
}
