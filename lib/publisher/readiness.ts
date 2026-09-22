import { axesFor } from "@/lib/page-axis/axes";
import { checkNicheReadiness, type NicheReadiness } from "@/lib/publisher/niche-readiness";
import { checkEntityNicheReadiness } from "@/lib/publisher/entity-readiness";

/**
 * Bảng "nghề này đã đủ để dựng site chưa", chọn đúng bảng cho đúng trục.
 *
 * File riêng chứ không đặt hàm này vào một trong hai bảng: bảng nào gọi bảng
 * kia cũng tạo ra một vòng import, và cả hai đều import kiểu của nhau.
 *
 * ═══ CHỌN THEO TRỤC, KHÔNG CHỌN THEO "CÓ ĐẶC TẢ KHÔNG" ═══
 *
 * Cách rẻ hơn là hỏi `entitySpecFor(vertical) !== null`. Nó sai ở đúng ca
 * quan trọng nhất: một nghề trục thực thể CHƯA khai đặc tả sẽ bị coi là nghề
 * địa lý, và bảng địa lý sẽ báo nó thiếu cluster, thiếu market, thiếu nguồn
 * dữ liệu, thiếu chỉ số — bốn cờ đỏ không cờ nào đúng, cho một nghề mà vấn đề
 * thật chỉ là chưa ai viết đặc tả.
 *
 * `axesFor` trả lời câu hỏi cấu trúc ("nghề này đi trục nào") độc lập với câu
 * hỏi nội dung ("đã viết chữ chưa"), nên nó vẫn đúng khi chữ còn thiếu.
 */
export async function checkReadiness(vertical: string): Promise<NicheReadiness> {
  if (axesFor(vertical).length > 0) return checkEntityNicheReadiness(vertical);
  return checkNicheReadiness(vertical);
}
