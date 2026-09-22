/**
 * Mùa giải châu Âu ĐANG diễn ra, suy từ ngày chứ không viết cứng.
 *
 * Viết cứng "2026-27" là một quả bom hẹn giờ im lặng: nó đúng suốt mười một
 * tháng rồi một ngày nào đó trang hiện mùa cũ, và không có gì đỏ lên. Người
 * đọc thấy một bảng xếp hạng đầy đủ, hợp lý, và sai.
 *
 * MỐC LÀ THÁNG 7, không phải tháng 8 dù mùa mới đá từ giữa tháng 8. Lý do đo
 * được: openfootball đẩy file `england/2026-27` vào 2/7/2026 — lịch mùa mới
 * có trước trận đầu tiên gần bảy tuần. Lấy mốc tháng 8 thì suốt tháng 7 trang
 * sẽ xin mùa đã kết thúc, tức hiện một bảng xếp hạng cuối mùa như thể nó là
 * hiện tại. Lấy mốc tháng 7 thì trường hợp xấu nhất là 404 trong ít ngày đầu
 * tháng 7 — và 404 thì chỗ gọi xử lý được, còn một mùa cũ trông như mùa mới
 * thì không ai phát hiện.
 */
export function currentEuropeanSeason(now: Date): string {
  const y = now.getUTCFullYear();
  const startYear = now.getUTCMonth() + 1 >= 7 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}
