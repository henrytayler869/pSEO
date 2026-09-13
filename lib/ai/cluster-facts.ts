import { buildFactSet, formatForPrompt, type Fact } from "@/lib/ai/facts";
import crypto from "node:crypto";

/**
 * Fact set cho một CỤM — các dải, không phải các con số đơn lẻ.
 *
 * Vì sao cần một hình dạng riêng: trang cụm gộp nhiều ZIP vào một trang, nên
 * nó không có "giá trị của nơi này". Brooklyn có 23 ZIP với tỷ lệ sở hữu nhà
 * từ 10,9% đến 67,3% — không con số nào trong đó là "tỷ lệ sở hữu của
 * Brooklyn", và viết như thể có là nói sai về 22 ZIP còn lại.
 *
 * Thứ trang cụm nói được mà không trang ZIP nào nói nổi chính là DẢI đó: một
 * ZIP chỉ có một giá trị, nên nó không biết mình nằm ở đâu trong quận.
 *
 * Chỉ số cấp COUNTY giống hệt nhau giữa các thành viên (cùng hạt), nên chúng
 * đi vào nguyên vẹn như một giá trị — dải của chúng sẽ luôn là một điểm, và
 * in ra "từ X đến X" là làm ra vẻ có thông tin.
 */

export interface ClusterFactSet {
  vertical: string;
  /** Nhãn người đọc được, lấy từ đường dẫn trang cụm lúc dựng. */
  label: string;
  /** ZIP thành viên, ĐÃ SẮP XẾP — vừa là danh tính cụm vừa là thứ tự ổn định
   * cho fingerprint. */
  memberZips: string[];
  city: string | null;
  state: string | null;
  county: string | null;
  facts: Fact[];
  /** Ý định tìm kiếm của từ khoá cụm. Mọi thành viên chung một từ khoá nên
   * chung một ý định. */
  searchIntent: string | null;
  fingerprint: string;
}

/** Chỉ số cấp ZIP mới có dải. Cấp county/state thì mọi thành viên bằng nhau. */
function isZipScoped(f: Fact): boolean {
  return f.scope === "ZIP";
}

export async function buildClusterFactSet(
  vertical: string,
  memberZips: string[],
  label: string
): Promise<ClusterFactSet | null> {
  const zips = [...memberZips].sort();
  const sets = [];
  for (const zip of zips) {
    const fs = await buildFactSet(vertical, zip);
    if (fs) sets.push({ zip, fs });
  }
  // Một cụm chỉ dựng được fact set cho một thành viên thì nó không còn là
  // cụm — dải của nó là một điểm, và đoạn văn về "sự khác nhau" sẽ không có
  // gì để nói.
  if (sets.length < 2) return null;

  const facts: Fact[] = [];

  // Dải cho từng chỉ số cấp ZIP, kèm ZIP giữ mỗi đầu.
  //
  // Nêu tên ZIP ở hai đầu là thông tin thật và kiểm được — nó cho người đọc
  // biết đầu nào là đầu nào thay vì chỉ biết khoảng cách. Không nêu thì câu
  // "từ 10,9% đến 67,3%" đúng nhưng không dùng được.
  const byKey = new Map<string, { zip: string; f: Fact }[]>();
  for (const { zip, fs } of sets) {
    for (const f of fs.facts) {
      if (!isZipScoped(f)) continue;
      byKey.set(f.key, [...(byKey.get(f.key) ?? []), { zip, f }]);
    }
  }
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.f.value - b.f.value);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    // Dải rộng bằng 0 thì bỏ: "từ 1938 đến 1938" là một dải không tồn tại,
    // và in nó ra là mời model viết một câu về sự khác biệt không có.
    if (lo.f.value === hi.f.value) continue;
    facts.push({
      key: `${key}__min`,
      label: `${lo.f.label} — thấp nhất trong ${sets.length} ZIP (ZIP ${lo.zip})`,
      value: lo.f.value,
      display: formatForPrompt(lo.f.value, lo.f.unit),
      unit: lo.f.unit,
      scope: "ZIP",
      scopeName: lo.zip,
    });
    facts.push({
      key: `${key}__max`,
      label: `${hi.f.label} — cao nhất trong ${sets.length} ZIP (ZIP ${hi.zip})`,
      value: hi.f.value,
      display: formatForPrompt(hi.f.value, hi.f.unit),
      unit: hi.f.unit,
      scope: "ZIP",
      scopeName: hi.zip,
    });
  }

  // Chỉ số rộng hơn ZIP: lấy từ thành viên đầu, vì chúng bằng nhau theo định
  // nghĩa của cụm (cùng hạt). Nếu một ngày chúng KHÔNG bằng nhau thì cụm đã
  // gộp sai, và dòng dưới sẽ giấu điều đó — nên kiểm và bỏ qua chỉ số lệch.
  const wider = new Map<string, Fact>();
  for (const { fs } of sets) {
    for (const f of fs.facts) {
      if (isZipScoped(f)) continue;
      const seen = wider.get(f.key);
      if (!seen) wider.set(f.key, f);
      else if (seen.value !== f.value) wider.delete(f.key);
    }
  }
  facts.push(...wider.values());

  const first = sets[0].fs;
  const canonical = [...facts].map((f) => [f.key, f.value] as const).sort((a, b) => a[0].localeCompare(b[0]));
  const fingerprint = crypto
    .createHash("sha256")
    // memberZips vào fingerprint: cụm thêm hay bớt một ZIP thì dải đổi, nên
    // bản văn cũ không còn đúng và cache phải trượt.
    .update(JSON.stringify({ vertical, zips, facts: canonical, intent: first.searchIntent }))
    .digest("hex")
    .slice(0, 32);

  return {
    vertical,
    label,
    memberZips: zips,
    city: first.city,
    state: first.state,
    county: first.county,
    facts,
    searchIntent: first.searchIntent,
    fingerprint,
  };
}

/** Danh tính ổn định của một cụm: hash của tập ZIP thành viên.
 *
 * KHÔNG dùng đường dẫn trang hay khoá từ khoá làm danh tính. Guide §3.5 ghi
 * rõ mainKeyword đổi được, và một đợt sửa mẫu từ khoá đã đổi chuỗi của
 * 233/582 market — mọi khoá cụm dạng chuỗi từ khoá đổi theo. Tập ZIP thì đổi
 * khi và chỉ khi cụm thật sự đổi, mà lúc đó văn bản cũng cần viết lại. */
export function clusterIdOf(vertical: string, memberZips: string[]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ vertical, zips: [...memberZips].sort() }))
    .digest("hex")
    .slice(0, 24);
}
