/**
 * Đồng bộ hàng `EntityIdentity` cho nghề bóng đá từ nguồn openfootball.
 *
 *     npm run football:sync           # ghi
 *     npm run football:sync -- --dry  # chỉ báo sẽ ghi gì
 *
 * ═══ KHÔNG XOÁ HÀNG THỪA, CHỈ BÁO ═══
 *
 * Một đội xuống hạng thì mùa sau nó không còn trong danh sách của giải, và
 * hàng của nó thành "thừa" theo nghĩa của lần đồng bộ này. Nhưng trang của nó
 * đã được index, đã có liên kết trỏ tới, và xoá một trang đã index là một
 * quyết định SEO — không phải hệ quả phụ của một lệnh đồng bộ chạy lúc nửa
 * đêm. Nên script báo ra và dừng ở đó.
 *
 * ═══ ĐỌC QUA fetchLeagueSeasonMerged ═══
 *
 * Bản JSON là NỀN, lớp phủ .txt mới mang kết quả mới nhất. Dùng nhầm hàm thì
 * danh sách đội vẫn đúng nhưng mọi thứ khác trễ một tuần, và không có gì đỏ
 * lên. Xem AGENTS.md.
 */
import { LEAGUES, fetchLeagueSeasonMerged, type LeagueCode } from "@/lib/football/openfootball";
import { currentEuropeanSeason } from "@/lib/football/season";
import { FOOTBALL_VERTICAL, fixtureKey, leagueKey, teamKey, teamSlug } from "@/lib/page-axis/axes";
import { teamDisplayName } from "@/lib/football/team-display-names";
import { prisma } from "@/lib/db/prisma";

interface Row {
  vertical: string;
  axis: string;
  key: string;
  parentKey: string | null;
  displayName: string;
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const now = new Date();
  const season = currentEuropeanSeason(now);
  const wanted: Row[] = [];

  for (const code of Object.keys(LEAGUES) as LeagueCode[]) {
    const s = await fetchLeagueSeasonMerged(code, season, now);
    const lKey = leagueKey(code);
    wanted.push({
      vertical: FOOTBALL_VERTICAL,
      axis: "league",
      key: lKey,
      parentKey: null,
      displayName: LEAGUES[code],
    });

    for (const t of s.teams) {
      wanted.push({
        vertical: FOOTBALL_VERTICAL,
        axis: "team",
        key: teamKey(code, t),
        parentKey: lKey,
        // KHOÁ vẫn dựng từ tên nguồn `t`, chữ hiển thị thì không — xem
        // `lib/football/team-display-names.ts`. Hai vai tách nhau ở đây:
        // đổi chữ mà không đổi URL.
        displayName: teamDisplayName(t),
      });
    }

    for (let i = 0; i < s.teams.length; i++) {
      for (let j = i + 1; j < s.teams.length; j++) {
        const a = s.teams[i];
        const b = s.teams[j];
        // Tên hiển thị phải theo ĐÚNG thứ tự của khoá đã sắp xếp, không theo
        // thứ tự vòng lặp: hai chuỗi lệch nhau sẽ cho ra một trang mà tiêu đề
        // nói "A gặp B" còn URL nói "b__a".
        const [first, second] = teamSlug(a) < teamSlug(b) ? [a, b] : [b, a];
        wanted.push({
          vertical: FOOTBALL_VERTICAL,
          axis: "fixture",
          key: fixtureKey(code, a, b),
          parentKey: lKey,
          // `vs`, không phải `gặp` — đo 24/9/2026: mồi "đối đầu mu vs
          // liverpool" trả 0 từ khoá, còn "mu vs liverpool" trả 8. Chuỗi này
          // là H1 của trang, nên nó phải mang chữ người ta gõ; `entity-spec`
          // đã đổi title cùng lý do.
          displayName: `${teamDisplayName(first)} vs ${teamDisplayName(second)}`,
        });
      }
    }
    console.log(
      `${code.padEnd(5)} ${String(s.teams.length).padStart(2)} đội, mùa ${s.season}, trễ ${s.stalenessDays ?? "?"} ngày`
    );
  }

  const existing = await prisma.entityIdentity.findMany({
    where: { vertical: FOOTBALL_VERTICAL },
    select: { axis: true, key: true, displayName: true },
  });
  const byKey = new Map(existing.map((r) => [`${r.axis} ${r.key}`, r]));
  const wantedKeys = new Set(wanted.map((r) => `${r.axis} ${r.key}`));

  const toCreate = wanted.filter((r) => !byKey.has(`${r.axis} ${r.key}`));
  const toRename = wanted.filter((r) => {
    const cur = byKey.get(`${r.axis} ${r.key}`);
    return cur !== undefined && cur.displayName !== r.displayName;
  });
  const extra = existing.filter((r) => !wantedKeys.has(`${r.axis} ${r.key}`));

  const count = (axis: string) => wanted.filter((r) => r.axis === axis).length;
  console.log(
    `\nNguồn: ${count("league")} giải, ${count("team")} đội, ${count("fixture")} cặp — tổng ${wanted.length}`
  );
  console.log(
    `DB đang có ${existing.length}. Thêm ${toCreate.length}, đổi tên ${toRename.length}, thừa ${extra.length}.`
  );

  if (extra.length > 0) {
    console.log("\nHàng THỪA — không xoá, xem đầu file:");
    for (const r of extra.slice(0, 20)) console.log(`  ${r.axis.padEnd(8)} ${r.key}`);
    if (extra.length > 20) console.log(`  … và ${extra.length - 20} hàng nữa`);
  }

  if (dry) {
    console.log("\n--dry: không ghi gì.");
    return;
  }

  if (toCreate.length > 0) {
    await prisma.entityIdentity.createMany({ data: toCreate, skipDuplicates: true });
  }
  for (const r of toRename) {
    await prisma.entityIdentity.update({
      where: { vertical_axis_key: { vertical: r.vertical, axis: r.axis, key: r.key } },
      data: { displayName: r.displayName },
    });
  }
  console.log("\nĐã ghi. Chạy `npm run verify:page-axis` để kiểm hàng vừa ghi.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
