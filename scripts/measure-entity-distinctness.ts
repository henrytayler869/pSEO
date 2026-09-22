/**
 * Đo độ GIỐNG NHAU giữa các trang của cùng một nghề.
 *
 *     npm run entity:distinctness -- 8
 *
 * Sinh (hoặc đọc lại từ cache) N trang đội trải đều 5 giải, rồi so TỪNG CẶP
 * bằng mạch từ tiếng Việt dài nhất dùng chung.
 *
 * ═══ VÌ SAO PHẢI ĐO TRƯỚC KHI SINH HÀNG LOẠT ═══
 *
 * Brief mục 4.2: "1.752 bài mỗi mùa dựng từ một tỷ số sẽ rất giống nhau nếu
 * chỉ đổi tên đội và con số." Đó là dự đoán, chưa ai kiểm. 96 trang đội dùng
 * CÙNG một bộ 19 chỉ số và CÙNG một prompt, nên nếu model viết chúng theo một
 * khuôn thì cả 96 trang là thin content — và biết điều đó sau khi sinh xong
 * thì đã trả tiền cho 96 lượt gọi rồi.
 *
 * `MAX_CROSS_PAGE_RUN_WORDS` KHÔNG được đặt bằng cảm tính: chạy cái này
 * trước, nhìn phân bố, rồi mới đặt số — đúng cách `MAX_SHARED_RUN_WORDS` của
 * trục địa lý đã được đặt (5 ZIP, đo được 0-13, chọn 16).
 */
import { getOrGenerateEntityInterpretation } from "@/lib/ai/entity-generate";
import { longestSharedPhraseVi, normaliseVi, wordCount } from "@/lib/ai/entity-distinctness";
import { LEAGUES, fetchLeagueSeasonMerged, buildStandings, type LeagueCode } from "@/lib/football/openfootball";
import { currentEuropeanSeason } from "@/lib/football/season";
import { FOOTBALL_VERTICAL, teamKey } from "@/lib/page-axis/axes";
import { prisma } from "@/lib/db/prisma";

async function main(): Promise<void> {
  const want = Number(process.argv[2] ?? 8);
  const now = new Date();
  const season = currentEuropeanSeason(now);

  // Trải đều 5 giải chứ không lấy 8 đội một giải: tám đội cùng giải chia nhau
  // cùng một tên giải và cùng một bộ số cấp giải, nên mẫu đó sẽ BÁO ĐỘNG GIẢ
  // về mức giống nhau. Câu hỏi thật là các trang trên toàn site giống nhau
  // tới đâu.
  const picks: { label: string; key: string }[] = [];
  const codes = Object.keys(LEAGUES) as LeagueCode[];
  for (let round = 0; picks.length < want; round++) {
    let added = 0;
    for (const code of codes) {
      if (picks.length >= want) break;
      const s = await fetchLeagueSeasonMerged(code, season, now);
      const table = buildStandings(s).filter((r) => r.played > 0);
      const row = table[round];
      if (!row) continue;
      picks.push({ label: `${row.team} (${code})`, key: teamKey(code, row.team) });
      added++;
    }
    if (added === 0) break;
  }

  console.log(`Lấy ${picks.length} trang đội trải trên ${codes.length} giải.\n`);

  const texts: { label: string; text: string }[] = [];
  let spent = 0;
  for (const p of picks) {
    const out = await getOrGenerateEntityInterpretation(FOOTBALL_VERTICAL, "team", p.key);
    if (!out || !out.validation.passed) {
      console.log(`  (bỏ qua ${p.label} — ${out ? "trượt validator" : "không sinh được"})`);
      continue;
    }
    spent += out.costUsd;
    texts.push({ label: p.label, text: out.text });
    console.log(`  ${out.cached ? "cache" : "sinh "} ${p.label}  ${normaliseVi(out.text).length} từ`);
  }

  console.log(`\nChi phí lượt này: $${spent.toFixed(4)}\n`);
  if (texts.length < 2) {
    console.log("Chưa đủ hai trang để so.");
    return;
  }

  // ── So từng cặp ────────────────────────────────────────────────────────
  const runs: number[] = [];
  let worst = { words: 0, phrase: "", a: "", b: "" };
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const phrase = longestSharedPhraseVi(texts[i].text, texts[j].text, 4);
      const words = wordCount(phrase);
      runs.push(words);
      if (words > worst.words) worst = { words, phrase: phrase ?? "", a: texts[i].label, b: texts[j].label };
    }
  }

  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)];
  const mean = runs.reduce((s, n) => s + n, 0) / runs.length;

  console.log(`${runs.length} cặp. Mạch trùng dài nhất, tính bằng TỪ tiếng Việt đã bỏ dấu:`);
  console.log(`  nhỏ nhất ${runs[0]}  |  giữa ${median}  |  trung bình ${mean.toFixed(1)}  |  lớn nhất ${runs.at(-1)}`);

  // Phân bố, để nhìn thấy đuôi chứ không chỉ thấy một con số tóm tắt.
  const buckets = new Map<number, number>();
  for (const r of runs) buckets.set(r, (buckets.get(r) ?? 0) + 1);
  console.log("\n  từ  số cặp");
  for (const [w, n] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${String(w).padStart(3)}  ${"█".repeat(n)} ${n}`);
  }

  if (worst.words > 0) {
    console.log(`\nCặp giống nhau nhất: ${worst.a}  vs  ${worst.b}  (${worst.words} từ)`);
    console.log(`  "${worst.phrase}"`);
  }

  console.log(
    `\nĐặt MAX_CROSS_PAGE_RUN_WORDS theo phân bố này — trên mức lớn nhất đo được một biên, ` +
      "và nghiêng về phía lỏng: trần quá chặt thì một trang mà fact buộc phải có mạch dài sẽ trượt " +
      "mọi lượt và KHÔNG CÓ VĂN NÀO, tệ hơn hẳn một mạch dài toàn số."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
