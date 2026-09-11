import { prisma } from "@/lib/db/prisma";
import { latestPerKeyword } from "./latest";

/**
 * Các ý định tìm kiếm CÓ THẬT trong bộ từ khoá của một ngành.
 *
 * Trước đây pipeline khai báo ba "ý định người đọc" trong code — move-underway,
 * choosing-place, market-context — và dựng cả bộ chọn ba nút trên chúng. Chúng
 * do tôi nghĩ ra. Endpoint DataForSEO đang gọi vẫn trả search_intent_info ở mỗi
 * từ khoá suốt thời gian đó, và adapter vứt nó đi ở bước .map().
 *
 * Đo 11/9/2026 cho moving-services: 8 commercial, 1 informational. Ba nút bày
 * ngang nhau mô tả sai hẳn hình dạng ngành — nó gợi ba nhóm người đọc cỡ bằng
 * nhau, trong khi gần như toàn bộ nhu cầu nằm ở một nhóm.
 *
 * Hàm này chỉ trả về ý định NÀO CÓ trong dữ liệu, kèm số từ khoá và tổng
 * volume làm bằng chứng. Ngành chỉ có một ý định thì trả về một — và giao diện
 * hiện đúng một nút, chứ không bịa thêm hai nút nữa cho cân.
 */

/** Bốn lớp DataForSEO dùng. Nhãn để hiển thị; danh sách này KHÔNG quyết định
 * ngành có gì — dữ liệu quyết định. */
const INTENT_LABELS: Record<string, string> = {
  commercial: "So sánh trước khi thuê",
  transactional: "Sẵn sàng đặt dịch vụ",
  informational: "Đang tìm hiểu",
  navigational: "Tìm một hãng cụ thể",
};

export function intentLabel(id: string): string {
  return INTENT_LABELS[id] ?? id;
}

export interface NicheIntent {
  id: string;
  label: string;
  /** Số từ khoá có ý định CHÍNH là cái này. */
  keywordCount: number;
  totalVolume: number;
  /** Số từ khoá có ý định chính khác, nhưng cũng phục vụ ý định này. Tách
   * riêng vì gộp vào sẽ đếm một từ khoá nhiều lần và thổi phồng mọi nhóm. */
  alsoServes: number;
  /** Từ khoá thật, để người đọc màn hình tự phán đoán thay vì tin con số. */
  examples: string[];
}

export interface IntentRow {
  keyword: string;
  searchVolume: number;
  mainIntent: string | null;
  foreignIntent: string[];
}

export async function nicheIntents(vertical: string): Promise<NicheIntent[]> {
  return summariseIntents(latestPerKeyword(await prisma.semanticKeyword.findMany({ where: { vertical } })));
}

/** Phần thuần, tách ra để kiểm được mà không cần database. */
export function summariseIntents(rows: IntentRow[]): NicheIntent[] {
  const byIntent = new Map<string, { count: number; volume: number; examples: string[] }>();
  const also = new Map<string, number>();

  for (const r of rows) {
    // mainIntent null = lần lấy đó chưa có trường này. Bỏ qua, KHÔNG gán vào
    // một nhóm mặc định: một từ khoá chưa đo ý định mà bị xếp vào "đang tìm
    // hiểu" sẽ thành bằng chứng giả cho một nhóm chưa ai đo.
    if (!r.mainIntent) continue;
    const e = byIntent.get(r.mainIntent) ?? { count: 0, volume: 0, examples: [] };
    e.count++;
    e.volume += r.searchVolume;
    // Ví dụ phải KHÁC NHAU. Nhiều thị trường chung một từ khoá dẫn đầu
    // ("moving companies new york" là từ khoá của mọi ZIP trong thành phố),
    // nên push thẳng sẽ in ra ba dòng giống hệt — trông như lỗi hiển thị và
    // che mất sự đa dạng thật của nhóm.
    if (e.examples.length < 3 && !e.examples.includes(r.keyword)) e.examples.push(r.keyword);
    byIntent.set(r.mainIntent, e);

    for (const f of r.foreignIntent) {
      if (f !== r.mainIntent) also.set(f, (also.get(f) ?? 0) + 1);
    }
  }

  return [...byIntent.entries()]
    .map(([id, e]) => ({
      id,
      label: intentLabel(id),
      keywordCount: e.count,
      totalVolume: e.volume,
      alsoServes: also.get(id) ?? 0,
      examples: e.examples,
    }))
    .sort((a, b) => b.totalVolume - a.totalVolume);
}

/**
 * Ý định mặc định của một ngành = ý định có tổng volume lớn nhất.
 *
 * Trả null khi CHƯA ĐO được ý định nào. Null không được đọc thành "ngành này
 * không có ý định" — nó nghĩa là khâu nghiên cứu từ khoá chưa chạy, và màn
 * hình phải nói đúng như vậy thay vì rơi về một giá trị mặc định trông như
 * một kết luận.
 */
export async function defaultIntent(vertical: string): Promise<string | null> {
  const list = await nicheIntents(vertical);
  return list[0]?.id ?? null;
}

/**
 * Ý định theo THỊ TRƯỜNG, tính trên chính từ khoá mỗi thị trường đang nhắm.
 *
 * Khác `nicheIntents` (dựa trên SemanticKeyword — từ khoá gợi ý quanh một
 * seed, mô tả cả ngành). Hàm này mới là thứ danh sách ứng viên lọc theo, nên
 * nút bấm phải đọc CÙNG nguồn với bộ lọc. Hai nguồn cho một câu hỏi là cách
 * con số trên nút không khớp số dòng bên dưới, và không ai biết bên nào sai.
 *
 * Mỗi thị trường tính một lần, theo từ khoá có volume cao nhất của nó — truy
 * vấn thị trường đó thật sự sống bằng.
 */
export async function marketIntents(vertical: string): Promise<NicheIntent[]> {
  const identities = await prisma.marketIdentity.findMany({
    where: { vertical },
    select: { zip: true, keywordMetrics: { select: { keyword: true, searchVolume: true, mainIntent: true } } },
  });

  const rows: IntentRow[] = [];
  for (const i of identities) {
    const lead = [...i.keywordMetrics].sort((a, b) => b.searchVolume - a.searchVolume)[0];
    if (!lead) continue;
    rows.push({ keyword: lead.keyword, searchVolume: lead.searchVolume, mainIntent: lead.mainIntent, foreignIntent: [] });
  }
  return summariseIntents(rows);
}
