/**
 * Cổng canh đặc tả nội dung của trục KHÔNG địa lý.
 *
 *     npm run verify:entity-spec
 *
 * ═══ NÓ SO ĐẶC TẢ VỚI THỨ THẬT SỰ PHÁT RA, KHÔNG VỚI MỘT DANH SÁCH ═══
 *
 * Một danh sách chỉ số viết tay ở đây sẽ là định nghĩa THỨ HAI về "nghề này
 * đo được gì", và nó trôi lệch khỏi tầng chỉ số ngay lần sửa đầu tiên. Nên
 * cổng này CHẠY tầng chỉ số trên dữ liệu thật của cả 5 giải, gom tập khoá
 * thực sự phát ra, rồi đối chiếu hai chiều:
 *
 *   đặc tả -> tầng chỉ số   đòi một chỉ số không ai phát thì mục đó KHÔNG BAO
 *                           GIỜ render, và im lặng
 *   tầng chỉ số -> đặc tả   phát một chỉ số mà đặc tả không nhắc tới thì có
 *                           hai khả năng — cố ý bỏ, hoặc quên. Hai thứ đó
 *                           nhìn giống hệt nhau trong mã và khác hẳn nhau về
 *                           hậu quả, nên `excluded` buộc phải phân biệt
 *
 * Chiều thứ hai là chiều mà đặc tả địa lý đã có (`verify-niche-spec.ts`) và
 * là lý do `excluded` tồn tại ở cả hai bên.
 *
 * Đọc mạng nên KHÔNG vào CI, cùng lý lẽ với verify:openfootball.
 */
import { LEAGUES, fetchLeagueSeasonMerged, buildStandings, type LeagueCode } from "@/lib/football/openfootball";
import { currentEuropeanSeason } from "@/lib/football/season";
import { fixtureFacts, fixtureStats, leagueStats, teamFacts, teamStats } from "@/lib/football/facts";
import { allEntitySpecs, metricsNamedByEntity, type EntityContentSpec } from "@/lib/content-spec/entity-spec";
import { isKnownAxis } from "@/lib/page-axis/axes";

let failures = 0;
const fail = (msg: string) => {
  console.error(`  ✗ ${msg}`);
  failures++;
};

/** Chỗ thay được phép xuất hiện trong chuỗi của đặc tả. */
const PLACEHOLDERS = new Set(["team", "opponent", "league", "season"]);

/** Gom mọi khoá chỉ số mà tầng chỉ số THỰC SỰ phát ra trên dữ liệu thật. */
async function emittedKeys(): Promise<Set<string>> {
  const now = new Date();
  const season = currentEuropeanSeason(now);
  const keys = new Set<string>();

  for (const code of Object.keys(LEAGUES) as LeagueCode[]) {
    const s = await fetchLeagueSeasonMerged(code, season, now);
    const lg = leagueStats(s);
    for (const row of buildStandings(s)) {
      for (const f of teamFacts(teamStats(s, row.team), lg)) keys.add(f.key);
    }
    // Chỉ cần vài cặp để gom khoá; cặp nào đã gặp nhau cũng phát cùng bộ khoá.
    for (let i = 0; i < s.teams.length; i++) {
      for (let j = i + 1; j < s.teams.length; j++) {
        for (const f of fixtureFacts(fixtureStats(s, s.teams[i], s.teams[j]), lg)) keys.add(f.key);
      }
    }
  }
  return keys;
}

function checkStrings(spec: EntityContentSpec): void {
  const used = new Set<string>();
  const scan = (text: string, where: string): void => {
    for (const m of text.matchAll(/\{([a-z]+)\}/g)) {
      if (!PLACEHOLDERS.has(m[1])) fail(`${where}: chỗ thay {${m[1]}} không được hỗ trợ`);
      else used.add(m[1]);
    }
  };

  for (const page of spec.pages) {
    if (!isKnownAxis(spec.vertical, page.axis)) {
      fail(`trang axis "${page.axis}" chưa khai ở lib/page-axis/axes.ts`);
    }
    scan(page.title, `${page.axis}.title`);
    scan(page.description, `${page.axis}.description`);
    scan(page.interpretationHeading, `${page.axis}.interpretationHeading`);
    for (const s of page.sections) scan(s.heading, `${page.axis}.${s.key}.heading`);

    for (const e of page.faq?.entries ?? []) {
      scan(e.question, `${page.axis}.faq.${e.key}.question`);
      // {metric:...} phải được liệt kê đủ trong `requires`, nếu không câu sẽ
      // render thiếu một chỗ thay và in ra nguyên văn "{metric:tên}".
      for (const m of e.answer.matchAll(/\{metric:([a-z0-9_]+)\}/g)) {
        if (!e.requires.includes(m[1])) {
          fail(`${page.axis}.faq.${e.key}: câu trả lời dùng {metric:${m[1]}} nhưng requires không có nó`);
        }
      }
      scan(e.answer.replace(/\{metric:[a-z0-9_]+\}/g, ""), `${page.axis}.faq.${e.key}.answer`);
    }

    // Một trang không mục nào là một trang trống được coi là hợp lệ.
    if (page.sections.length === 0) fail(`trang "${page.axis}" không có mục nào`);
  }
  if (used.size === 0) fail("không chuỗi nào dùng chỗ thay — mọi trang sẽ mang tiêu đề giống hệt nhau");
}

async function main(): Promise<void> {
  const emitted = await emittedKeys();
  console.log(`Tầng chỉ số phát ra ${emitted.size} khoá trên dữ liệu thật của 5 giải.\n`);

  for (const spec of allEntitySpecs()) {
    console.log(`── ${spec.vertical} ──────────────────────────────────────────`);
    checkStrings(spec);

    const named = metricsNamedByEntity(spec);

    // Chiều 1: đặc tả đòi thứ không ai phát.
    for (const m of named) {
      if (!emitted.has(m)) fail(`đặc tả nhắc chỉ số "${m}" mà tầng chỉ số KHÔNG phát ra`);
    }
    // Chiều 2: tầng chỉ số phát thứ đặc tả không nhắc, và cũng không cố ý bỏ.
    for (const k of emitted) {
      if (!named.has(k)) {
        fail(`chỉ số "${k}" được phát ra nhưng đặc tả không dùng và cũng không khai ở excluded`);
      }
    }

    const sections = spec.pages.reduce((n, p) => n + p.sections.length, 0);
    const faqs = spec.pages.reduce((n, p) => n + (p.faq?.entries.length ?? 0), 0);
    console.log(
      `  ${spec.pages.length} loại trang, ${sections} mục, ${faqs} câu FAQ, ` +
        `${spec.excluded.length} chỉ số cố ý bỏ, ${spec.unavailable.length} thứ KHÔNG có nguồn`
    );
  }

  console.log("");
  if (failures > 0) {
    console.error(`ĐỎ — ${failures} vấn đề.`);
    process.exit(1);
  }
  console.log("XANH — đặc tả và tầng chỉ số khớp nhau hai chiều.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
