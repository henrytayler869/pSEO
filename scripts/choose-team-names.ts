/**
 * Ghép số đo vào từng đội và CHỌN tên hiển thị, rồi in bảng để người duyệt.
 *
 *     tsx scripts/choose-team-names.ts /tmp/team-vol.tsv
 *
 * ═══ VÌ SAO KHÔNG CHỌN BẰNG VOLUME MỘT MÌNH ═══
 *
 * Đo 24/9/2026, vùng 2704, tiếng Việt:
 *
 *     barcelona        550.000  kd=60
 *     barca            550.000  kd=34
 *     manchester city  550.000  kd=76
 *     man city         550.000  kd=59
 *
 * Volume BẰNG NHAU từng cặp. Đó không phải trùng hợp: Google Ads gộp các
 * biến thể gần nhau vào một nhóm và trả cùng một con số, nên volume KHÔNG
 * phân biệt được `barca` với `barcelona`. Chọn bằng volume ở đây là chọn
 * bằng thứ tự xuất hiện trong mảng — tức chọn bừa, mà trông như có căn cứ.
 *
 * KD thì phân biệt được, vì nó tính từ SERP THẬT của từng chuỗi. Nên luật
 * là: lấy nhóm volume cao nhất, rồi trong nhóm đó lấy KD THẤP NHẤT. Với một
 * site DR 0 chưa có domain, KD thấp hơn là thứ đáng lấy.
 *
 * ═══ ĐẦU RA LÀ ĐỀ XUẤT, KHÔNG PHẢI KẾT LUẬN ═══
 *
 * Script in bảng cho NGƯỜI đọc, không ghi thẳng vào mã. Phép sinh ứng viên
 * là cơ học nên nó đẻ ra được những chuỗi có volume mà không phải tên đội:
 * `bayer` (hãng dược) cho Bayer 04 Leverkusen là ca đã biết. Một ứng viên
 * sai mà CÓ số thì tệ hơn một ứng viên thiếu, và chỉ mắt người bắt được nó.
 */
import fs from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { FOOTBALL_VERTICAL } from "@/lib/page-axis/axes";
import { candidatesFor } from "./probe-team-names";

interface Measure {
  volume: number | null;
  kd: number | null;
}

function readMeasures(path: string): Map<string, Measure> {
  const out = new Map<string, Measure>();
  const lines = fs.readFileSync(path, "utf-8").split("\n").slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const [kw, sv, , kd] = line.split("\t");
    out.set(kw.trim().toLowerCase(), {
      volume: sv === "no-data" || sv === undefined ? null : Number(sv),
      kd: kd === "-" || kd === undefined ? null : Number(kd),
    });
  }
  return out;
}

async function main(): Promise<void> {
  const tsv = process.argv[2];
  if (!tsv) throw new Error("Dùng: tsx scripts/choose-team-names.ts <đường dẫn .tsv từ probe-keywords>");
  const measures = readMeasures(tsv);

  const rows = await prisma.entityIdentity.findMany({
    where: { vertical: FOOTBALL_VERTICAL, axis: "team" },
    select: { displayName: true, key: true },
    orderBy: { key: "asc" },
  });

  console.log("đội (openfootball)\tđề xuất\tvolume\tkd\tứng viên khác");
  for (const { displayName } of rows) {
    const scored = candidatesFor(displayName)
      .map((c) => ({ c, ...(measures.get(c) ?? { volume: null, kd: null }) }))
      .filter((x) => x.volume !== null && x.volume > 0)
      // volume giảm dần; CÙNG volume thì KD thấp trước (xem chú thích đầu file)
      .sort((a, b) => (b.volume! - a.volume!) || ((a.kd ?? 999) - (b.kd ?? 999)));

    if (scored.length === 0) {
      console.log(`${displayName}\t(KHÔNG ỨNG VIÊN NÀO CÓ SỐ)\t-\t-\t-`);
      continue;
    }
    const best = scored[0];
    const others = scored.slice(1, 4).map((x) => `${x.c}:${x.volume}/kd${x.kd ?? "-"}`).join(" ");
    const changed = best.c.toLowerCase() === displayName.toLowerCase() ? "" : " *";
    console.log(`${displayName}${changed}\t${best.c}\t${best.volume}\t${best.kd ?? "-"}\t${others}`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
