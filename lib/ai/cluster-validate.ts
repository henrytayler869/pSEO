import { extractNumbers, matchesFact, checkUnitWords } from "@/lib/ai/validate";
import type { ClusterFactSet } from "@/lib/ai/cluster-facts";

/**
 * Validator cho đoạn văn cấp cụm.
 *
 * Dùng lại nguyên hai phép kiểm quan trọng nhất của validator trang ZIP — mọi
 * con số phải truy được về một fact, và từ đơn vị phải khớp — vì chúng không
 * phụ thuộc vào phạm vi.
 *
 * KHÔNG dùng rule "scope_overclaim" của bên kia: nó kêu khi một câu gán số
 * cấp county cho ZIP, mà đoạn cụm không nói về ZIP nào cả. Thay vào đó là rủi
 * ro tương đương của hình dạng này, và nó nguy hiểm y như vậy:
 *
 *   "Tỷ lệ sở hữu nhà ở Brooklyn là 13,8%."
 *
 * 13,8% là số THẬT — nhưng nó là đầu THẤP của một dải chạy tới 67,3%, tức là
 * số của một ZIP nói như thể là số của cả 23. Một con số thật đặt sai phạm vi
 * không bị rule nào của bên kia bắt, vì không câu nào nhắc tới ZIP.
 */

export const CLUSTER_VALIDATOR_RULES = ["unsupported_number", "wrong_unit", "range_endpoint_as_whole"] as const;

export type ClusterValidatorRule = (typeof CLUSTER_VALIDATOR_RULES)[number];

/** Kiểu riêng, không dùng lại ValidationIssue của validator ZIP: tập luật
 * khác nhau, và gộp hai union lại sẽ cho phép viết một rule của bên này vào
 * báo cáo của bên kia mà trình biên dịch không kêu. */
export interface ClusterValidationIssue {
  rule: ClusterValidatorRule;
  detail: string;
}

export interface ClusterValidationResult {
  passed: boolean;
  issues: ClusterValidationIssue[];
}

/** Dấu hiệu câu đang nói về một DẢI chứ không gán một giá trị cho cả cụm. */
const RANGE_SIGNAL =
  /\b(from|to|between|range[sd]?|ranging|as (low|high) as|lowest|highest|varies|spread|across (the )?\d+ ZIP|depending on)\b/i;

export function validateClusterText(text: string, set: ClusterFactSet): ClusterValidationResult {
  const issues: ClusterValidationIssue[] = [];

  // --- Rule 1: mọi con số phải truy được về một fact ---
  for (const { raw, value } of extractNumbers(text)) {
    if (matchesFact(value, set.facts)) continue;
    issues.push({
      rule: "unsupported_number",
      detail: `Số "${raw}" không có trong danh sách fact của cụm ${set.label}.`,
    });
  }

  // --- Rule 2: từ đơn vị phải khớp ---
  // checkUnitWords trả ValidationIssue của bên ZIP, nhưng nó chỉ phát ra
  // "wrong_unit" — tên luật có mặt trong cả hai tập, nên ép kiểu ở đây là an
  // toàn và được kiểm bằng test bên dưới.
  for (const i of checkUnitWords(text, set.facts)) {
    issues.push({ rule: "wrong_unit", detail: i.detail });
  }

  // --- Rule 3: đầu dải không được nói như giá trị của cả cụm ---
  const endpoints = set.facts.filter((f) => f.key.endsWith("__min") || f.key.endsWith("__max"));
  if (endpoints.length > 0) {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (RANGE_SIGNAL.test(sentence)) continue;
      for (const { raw, value } of extractNumbers(sentence)) {
        // matchesFact chứ KHÔNG phải so `===`. Fact lưu 10.892, văn bản viết
        // "10.9%" — model được phép bỏ chữ số thập phân, và luật này từng
        // không kêu lần nào vì so thẳng hai số đó. Bộ test bắt được, không
        // phải lần đọc lại nào.
        const hit = matchesFact(value, endpoints);
        if (!hit) continue;
        issues.push({
          rule: "range_endpoint_as_whole",
          detail:
            `Câu "${sentence.trim().slice(0, 90)}…" nêu ${raw} mà không nói đó là một đầu của dải. ` +
            `Con số này là ${hit.label} — nó mô tả MỘT ZIP, không mô tả cả ${set.memberZips.length} ZIP của ${set.label}.`,
        });
      }
    }
  }

  return { passed: issues.length === 0, issues };
}
