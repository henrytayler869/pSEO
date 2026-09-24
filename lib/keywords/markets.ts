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
 * Ba mồi dưới đây cố tình ở ba nhánh khác nhau của cùng chủ đề: kết quả,
 * bảng xếp hạng, và đối đầu. Nhánh nào rỗng thì đó là dữ liệu về nhánh đó,
 * không phải về cả chủ đề.
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
      // nhánh ĐỐI ĐẦU — nhánh mà 876/977 trang của site đang nằm trên,
      // và là nhánh chưa ai kiểm có cầu hay không
      "đối đầu mu vs liverpool",
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
