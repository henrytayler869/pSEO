import { buildFactSet, formatForPrompt, type Fact } from "@/lib/ai/facts";
import type { ClusterFactSet } from "@/lib/ai/cluster-facts";
import crypto from "node:crypto";

/**
 * Fact set cho hub của một bang chỉ có MỘT ZIP được publish.
 *
 * Vấn đề: 7 bang như vậy (sc, ct, nm, ok, ma, id, oh), hub 111-171 từ, và
 * cách chữa cho các bang khác — dải giữa các ZIP trong bang — không áp được
 * vì một ZIP không tạo thành dải. Một trong số đó là /moving-services/oh,
 * đúng một trong hai hub Google đã đọc rồi TỪ CHỐI.
 *
 * Thứ hub một-ZIP nói được mà trang ZIP bên dưới KHÔNG nói được: **vị trí
 * của ZIP đó trong toàn bộ tập đã publish**. Trang ZIP chỉ có số của chính
 * nó, nên nó không biết mình đứng đâu so với 158 ZIP còn lại. Đó là một
 * khẳng định KHÁC, không phải cùng khẳng định viết lại.
 *
 * Vì sao không so với "trung bình toàn quốc" kiểu chung chung: ta không đo
 * toàn quốc. Ta đo 158 ZIP mà site này publish, và câu phải nói đúng như
 * vậy — nhãn của từng fact ghi rõ mẫu số.
 */

/** Đủ rộng để "đứng ở đâu" có nghĩa. Dưới mức này thì so sánh là so với vài
 * điểm lẻ, và một kết luận rút từ 4 mẫu nghe chắc chắn hơn nó đáng được. */
const MIN_COMPARISON_SET = 20;

/**
 * Phân bố từng chỉ số cấp ZIP trên toàn tập đã publish.
 *
 * Dựng MỘT LẦN rồi dùng cho mọi bang, không dựng lại cho từng bang. Bản đầu
 * dựng trong buildSoloStateFactSet, tức 7 bang × 255 ZIP = 1.785 lần
 * buildFactSet, mỗi lần vài truy vấn — chạy 30 phút mà chưa gọi model lần
 * nào. Tập so sánh giống hệt nhau cho cả 7 bang; chỉ khác việc loại ZIP của
 * chính bang đó ra, và việc đó làm được lúc đọc.
 */
export type ZipPool = Map<string, { zip: string; f: Fact }[]>;

export async function buildZipPool(vertical: string, zips: string[]): Promise<ZipPool> {
  const pool: ZipPool = new Map();
  for (const z of zips) {
    const fs = await buildFactSet(vertical, z);
    if (!fs) continue;
    for (const f of fs.facts) {
      if (f.scope !== "ZIP") continue;
      pool.set(f.key, [...(pool.get(f.key) ?? []), { zip: z, f }]);
    }
  }
  return pool;
}

export async function buildSoloStateFactSet(
  vertical: string,
  zip: string,
  label: string,
  pool: ZipPool
): Promise<ClusterFactSet | null> {
  const own = await buildFactSet(vertical, zip);
  if (!own) return null;

  const poolSize = new Set([...pool.values()].flat().map((x) => x.zip)).size;
  if (poolSize - 1 < MIN_COMPARISON_SET) return null;

  const facts: Fact[] = [];

  // KÍCH THƯỚC tập so sánh là một fact.
  //
  // Bỏ sót nó làm cả 7 bang trượt lần đầu với cùng một lỗi: model viết "out
  // of 255 ZIP codes" — một câu đúng và tự nhiên — nhưng 255 không có trong
  // fact list nên validator từ chối. Mỗi bang tốn gấp đôi vì thiếu một dòng.
  //
  // Bài học chung: con số mà prompt MỜI model viết phải là fact. Nhãn
  // "trong 255 ZIP đã publish" mời nói 255, rồi luật cấm nói 255.
  facts.push({
    key: "comparison_pool_size",
    label: "Tổng số ZIP đã publish dùng làm tập so sánh (KHÔNG gồm ZIP này)",
    value: poolSize - 1,
    display: formatForPrompt(poolSize - 1, "count"),
    unit: "count",
    scope: "ZIP",
    scopeName: "toàn bộ ZIP đã publish",
  });

  for (const f of own.facts) {
    // Chỉ số rộng hơn ZIP đi vào nguyên vẹn: chúng mô tả hạt/bang thật, và
    // so chúng với phân bố ZIP là so hai thứ khác đơn vị đo.
    if (f.scope !== "ZIP") { facts.push(f); continue; }

    // Loại chính ZIP này ra khỏi tập so sánh: "cao hơn 112 trong 157 ZIP"
    // phải là 157 ZIP KHÁC, không gồm nó. Tự so với chính mình làm mẫu số
    // sai và thứ hạng lệch một bậc.
    const list = (pool.get(f.key) ?? []).filter((x) => x.zip !== zip);
    if (list.length < MIN_COMPARISON_SET) { facts.push(f); continue; }

    const sorted = [...list].sort((a, b) => a.f.value - b.f.value);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    const below = sorted.filter((x) => x.f.value < f.value).length;

    facts.push({ ...f, label: `${f.label} — ZIP ${zip}, ZIP DUY NHẤT được publish ở bang này` });
    facts.push({
      key: `${f.key}__rank`,
      // Thứ hạng là một con số, nên nó phải là một FACT để validator kiểm
      // được. Để nó ngoài fact set nghĩa là model tự nói "cao hơn phần lớn"
      // mà không ai đối chiếu được với gì.
      label: `Số ZIP (trong ${sorted.length} ZIP đã publish của niche) có ${f.label} THẤP HƠN ZIP ${zip}`,
      value: below,
      display: formatForPrompt(below, "count"),
      unit: "count",
      scope: "ZIP",
      scopeName: `${sorted.length} ZIP đã publish`,
    });
    facts.push({
      key: `${f.key}__poollow`,
      label: `${f.label} — thấp nhất trong ${sorted.length} ZIP đã publish (ZIP ${lo.zip})`,
      value: lo.f.value,
      display: formatForPrompt(lo.f.value, lo.f.unit),
      unit: lo.f.unit,
      scope: "ZIP",
      scopeName: lo.zip,
    });
    facts.push({
      key: `${f.key}__poolhigh`,
      label: `${f.label} — cao nhất trong ${sorted.length} ZIP đã publish (ZIP ${hi.zip})`,
      value: hi.f.value,
      display: formatForPrompt(hi.f.value, hi.f.unit),
      unit: hi.f.unit,
      scope: "ZIP",
      scopeName: hi.zip,
    });
  }

  const canonical = facts.map((f) => [f.key, f.value] as const).sort((a, b) => a[0].localeCompare(b[0]));
  return {
    vertical,
    label,
    // Một phần tử: danh tính của hub này là chính ZIP đó. Khác tập của trang
    // ZIP (bảng khác) nên không đụng nhau, và khác mọi cụm vì không cụm nào
    // có đúng một thành viên.
    memberZips: [zip],
    city: own.city,
    state: own.state,
    county: own.county,
    facts,
    searchIntent: own.searchIntent,
    fingerprint: crypto
      .createHash("sha256")
      // Số ZIP trong tập so sánh vào fingerprint: tập đổi thì thứ hạng đổi,
      // nên câu cũ không còn đúng và cache phải trượt.
      .update(JSON.stringify({ vertical, zip, pool: poolSize, facts: canonical }))
      .digest("hex")
      .slice(0, 32),
  };
}
