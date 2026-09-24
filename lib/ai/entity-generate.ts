import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { generateWithClaude, IncompleteGenerationError } from "@/lib/ai/anthropic";
import { validateEntityText, type EntityValidationResult } from "@/lib/ai/entity-validate";
import {
  fixtureFacts, fixtureStats, leagueFacts, leagueStats, teamFacts, teamStats,
  type FootballFact,
} from "@/lib/football/facts";
import { LEAGUES, fetchLeagueSeasonMerged, type LeagueCode } from "@/lib/football/openfootball";
import { currentEuropeanSeason } from "@/lib/football/season";
import { FOOTBALL_VERTICAL, parseKey, teamSlug } from "@/lib/page-axis/axes";

/**
 * Sinh đoạn diễn giải cho một trang trên trục THỰC THỂ.
 *
 * ═══ VÌ SAO KHÔNG DÙNG LẠI `lib/ai/generate.ts` ═══
 *
 * `SYSTEM_PROMPT` bên đó mở đầu bằng "You write short, factual copy for local
 * service pages" và kết bằng "for a person deciding who to hire". Bốn trong
 * chín luật của nó chỉ có nghĩa trong thế giới ZIP:
 *
 *   luật 2   số cấp hạt/bang không được gán cho ZIP
 *   luật 4   không nêu tên nơi chốn không có trong fact
 *   luật 8   KHÔNG GÌ ở đây đo phía cung — không suy ra số thợ, độ bận, giá
 *   luật 9   cấm nối một con số với một câu về "các công ty ở đây"
 *
 * Không luật nào dịch sang bóng đá, và luật 8-9 thì còn sai hướng: ở đây mọi
 * fact đều nói về CHÍNH đội đang được viết, nên cấm "suy ra điều gì về chủ
 * thể" sẽ cấm luôn thứ trang cần nói.
 *
 * Nhưng nguy hiểm thật không nằm ở chỗ luật cũ vô dụng — nó nằm ở chỗ nghề
 * này có hai cám dỗ RIÊNG mà prompt cũ không có một chữ nào chặn: nói về cầu
 * thủ (không nguồn nào có), và trượt sang giọng soi kèo (vì tài xỉu 2,5 và
 * hai đội cùng ghi bàn vốn là tên hai kèo cược).
 */

/**
 * Brief của nghề: viết về cái gì, và TUYỆT ĐỐI không được nói gì.
 *
 * `offLimits` liệt kê tường minh chứ không dựa vào suy diễn, cùng cách mà
 * brief nghề luật đã phải làm: dạng nguy hiểm nhất ở đây là từ vựng của CHÍNH
 * môn thể thao này — tên cầu thủ, phút ghi bàn, đội hình — chứ không phải từ
 * vựng của ngành khác. Một luật kiểu "đừng nói như ngành khác" trượt hoàn
 * toàn nhóm đó.
 *
 * Đây là bản sinh đôi ở tầng prompt của `UNSUPPORTED_TERMS` và
 * `BETTING_TERMS` trong `entity-validate.ts` — hai chỗ, cùng một tập cấm, cố
 * ý viết cùng lúc để không chỗ nào lỏng hơn chỗ kia.
 */
const ENTITY_BRIEFS: Record<string, { does: string; offLimits: string }> = {
  [FOOTBALL_VERTICAL]: {
    does: "thống kê bóng đá nam cấp ĐỘI ở năm giải vô địch quốc gia châu Âu, suy ra từ kết quả từng trận",
    offLimits:
      "TUYỆT ĐỐI không nhắc tới bất cứ điều gì ở cấp CẦU THỦ: tên cầu thủ, người ghi bàn, phút ghi bàn, " +
      "kiến tạo, đội hình ra sân, thay người, thẻ vàng, thẻ đỏ, chấn thương, chuyển nhượng. Nguồn dữ liệu " +
      "chỉ có tỷ số từng trận — không có một dòng nào về cầu thủ — nên mọi câu như vậy là bịa. " +
      "Cũng không nhắc kiểm soát bóng, số cú sút, số phạt góc: không nguồn nào đo. " +
      "KHÔNG DỰ ĐOÁN và KHÔNG GIỌNG CÁ CƯỢC: không 'kèo', 'cửa trên', 'cửa dưới', 'soi kèo', 'nhà cái', " +
      "'dự đoán', 'chắc chắn thắng'. Hai chỉ số 'tỷ lệ trận trên 2,5 bàn' và 'hai đội cùng ghi bàn' đúng là " +
      "tên hai kèo cược, nhưng ở đây chúng là thống kê MÔ TẢ về những trận ĐÃ đá — viết chúng như lời khuyên " +
      "đặt cược là đổi hẳn thể loại của trang. " +
      "KHÔNG SUY NHÂN QUẢ: dữ liệu chỉ có tỷ số, nên không được viết đội thắng NHỜ hàng thủ chắc, NHỜ phong độ " +
      "sân nhà, hay VÌ bất cứ nguyên nhân nào — không con số nào ở đây đo nguyên nhân. Nêu con số, nói nó đo gì, " +
      "rồi dừng câu.",
  },
};

/** Nghề mà tầng này chịu viết. Bảng readiness đọc danh sách NÀY, không đọc
 *  `VERTICALS_WITH_BRIEFS` của trục địa lý — hai prompt khác nhau thì hai
 *  danh sách khác nhau, và gộp chúng sẽ báo "đã có brief" cho một nghề mà
 *  prompt tương ứng không tồn tại. */
export const ENTITY_VERTICALS_WITH_BRIEFS = Object.keys(ENTITY_BRIEFS);

const MAX_ATTEMPTS = 2; // một lần thử lại: trượt lần hai là vấn đề của prompt, không phải may rủi

export function entitySystemPrompt(vertical: string): string {
  const brief = ENTITY_BRIEFS[vertical];
  if (!brief) {
    // Không có brief thì KHÔNG rơi về một prompt chung. Chính cái fallback là
    // thứ đã cho 90 trang tai nạn nói về chuyển nhà.
    throw new Error(
      `Nghề "${vertical}" chưa có brief ở lib/ai/entity-generate.ts. Không sinh nội dung khi thiếu nó.`
    );
  }
  return `Bạn viết đoạn văn ngắn, thuần số liệu, bằng TIẾNG VIỆT, cho một trang thống kê bóng đá.

Bạn sẽ nhận một danh sách các CHỈ SỐ ĐÃ ĐO. Đó là những sự kiện duy nhất bạn được phép nêu.

LUẬT BẮT BUỘC:
1. Không bao giờ nêu một con số không có trong danh sách. Không tính, không cộng trừ, không ước lượng, không suy ra số mới từ các số đã cho.
2. Chỉ viết về CHÍNH đội (hoặc cặp đối đầu) của trang này. Số liệu chung của cả giải — tỷ lệ trận trên 2,5 bàn, tỷ lệ chủ nhà thắng, tổng số trận toàn giải — KHÔNG có trong danh sách và trang đã hiển thị chúng ở một mục riêng. Nhắc lại chúng ở đây là viết cùng một câu trên mọi trang của giải đó.
3. Không diễn đạt tỷ lệ bằng chữ ("một nửa", "một phần ba", "đa số"). Muốn nêu tỷ lệ thì dùng đúng con số đã đo, nguyên văn.
4. Viết số ĐÚNG như cách nó được in trong danh sách. "52,0%" viết là "52,0%", không đổi thành "52%" hay "52.0%".
5. Bạn được phép bỏ qua bất kỳ chỉ số nào. Bạn không được thêm chỉ số nào.
6. Chỉ số nào có kèm MẪU SỐ thì phải nêu mẫu số cùng nó. "Ghi 7 bàn trong hiệp một" mà không nói "trong 4 trận biết tỷ số hiệp một" là một con số không đọc được.

PHẠM VI CỦA TRANG NÀY: ${brief.does}.

CẤM: ${brief.offLimits}

Viết 3-5 câu tiếng Việt trôi chảy, không tiêu đề, không gạch đầu dòng, không tính từ quảng cáo.`;
}

export interface EntityFactSet {
  vertical: string;
  axis: string;
  key: string;
  displayName: string;
  /** Tên giải, để prompt và validator biết scopeName nào là cấp giải. */
  leagueName: string;
  season: string;
  /** Số ngày từ trận mới nhất có tỷ số. Đi vào prompt để văn không nói
   *  "cập nhật hôm nay" theo thời điểm dựng trang — brief mục 4.2. */
  stalenessDays: number | null;
  /** TOÀN BỘ chỉ số, kể cả cấp GIẢI. Đây là thứ TRANG render. */
  facts: FootballFact[];
  /**
   * Tập đưa cho MODEL, đã bỏ chỉ số cấp giải.
   *
   * Tách khỏi `facts` sau khi đo 22/9/2026 và thấy cài đặt mâu thuẫn với
   * thiết kế của chính nó: `forModel` lọc ngay trong `buildEntityFactSet`,
   * nên endpoint — vốn dùng cùng hàm đó — trả về tập ĐÃ LỌC cho trang, và
   * mục `league-context` không bao giờ render được. Chú thích của `forModel`
   * đã ghi đúng ý định ("trang VẪN cần chỉ số cấp giải") và mã làm ngược lại.
   *
   * Validator chấm văn bản trên CHÍNH tập này, nên hai trường không được
   * hoán đổi cho nhau.
   */
  modelFacts: FootballFact[];
  fingerprint: string;
}

function fingerprintOf(facts: readonly FootballFact[], season: string, displayName: string): string {
  // Sắp xếp theo khoá: thứ tự phát ra không phải một phần của sự thật, và để
  // nó ảnh hưởng vân tay sẽ làm cache trượt mỗi lần đổi thứ tự trong mã.
  const body = [...facts]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((f) => `${f.key}=${f.value}`)
    .join("|");
  return crypto.createHash("sha256").update(`${season}|${displayName}|${body}`).digest("hex").slice(0, 16);
}

/**
 * Chỉ số cấp GIẢI KHÔNG đi vào tập fact của model — và đây là phép sửa một
 * bệnh ĐO ĐƯỢC, không phải một tinh chỉnh khẩu vị.
 *
 * Đo 22/9/2026, `npm run entity:distinctness -- 8` trên 8 trang đội trải 5
 * giải, 28 cặp. Mạch từ tiếng Việt dài nhất dùng chung: nhỏ nhất 6, giữa 10,
 * LỚN NHẤT 29. Cặp tệ nhất là Manchester City vs Arsenal, và mạch 29 từ đó
 * chính là câu bối cảnh giải:
 *
 *     "toan giai ngoai hang anh da da 50 tran voi ty le tran tren 2 5 ban
 *      la 52 0 va ty le chu nha thang la 36 0"
 *
 * Nguyên nhân là CẤU TRÚC: cả 20 đội Ngoại hạng Anh nhận y hệt bộ chỉ số cấp
 * giải, nên model viết ra y hệt một câu. Riêng giải đó là 190 cặp trang chia
 * nhau cùng một câu — đúng hình dạng "21/76 trang in governmentData trùng
 * khít từng chữ số" của nghề tai nạn, chỉ đổi trục.
 *
 * Nâng trần sẽ là giấu bệnh. Chỗ đúng của số cấp giải là một MỤC TẤT ĐỊNH —
 * `league-context` trong đặc tả đã làm việc đó — chứ không phải văn xuôi trả
 * tiền để viết lại cùng một câu 20 lần.
 *
 * Lọc ở đây chứ không ở `teamFacts`: trang VẪN cần chỉ số cấp giải để render
 * mục của nó. Chỉ riêng người đọc "model" là không được nhận. Và vì validator
 * chấm văn bản trên CHÍNH tập này, một con số cấp giải lọt vào văn sẽ bị từ
 * chối là `unsupported_number` — luật tự thi hành, không cần thêm lời dặn.
 */
function forModel(facts: FootballFact[]): FootballFact[] {
  return facts.filter((f) => f.scope !== "LEAGUE");
}

const leagueCodeOf = (slug: string): LeagueCode | null => {
  const code = slug.replace(/-/g, ".");
  return code in LEAGUES ? (code as LeagueCode) : null;
};

/**
 * Dựng tập fact cho một trang, ĐỌC TỪ NGUỒN.
 *
 * Trả null khi khoá không giải mã được hoặc đội không có trong mùa đang đá —
 * null chứ không ném, vì người gọi có thể là một route và một khoá do người lạ
 * gõ phải ra 404 chứ không ra 500.
 */
/**
 * Mùa giải đã nạp sẵn, để dựng fact cho HÀNG NGHÌN khoá mà không gọi mạng
 * hàng nghìn lần.
 *
 * `buildEntityFactSet` gọi `fetchLeagueSeasonMerged` một lần mỗi khoá. Với
 * một khoá thì đúng; với 977 khoá của site bóng đá thì đó là ~1.500 request
 * tới GitHub (mỗi giải một JSON và một .txt) để lấy đúng NĂM kết quả khác
 * nhau.
 *
 * Nên chỗ gọi theo lô nạp trước bằng `loadSeasons()` rồi truyền map xuống.
 * KHÔNG đặt cache ở module scope: hàm này còn phục vụ đường sinh văn chạy
 * trong server dài hạn, và một cache ẩn ở đó sẽ phục vụ số của mùa trước mà
 * không ai thấy. Tham số tường minh thì chỗ gọi tự quyết vòng đời.
 */
export type SeasonCache = Map<string, Awaited<ReturnType<typeof fetchLeagueSeasonMerged>>>;

/** Nạp cả năm giải đúng một lần. Khoá map là mã giải. */
export async function loadSeasons(now: Date = new Date()): Promise<SeasonCache> {
  const season = currentEuropeanSeason(now);
  const codes = Object.keys(LEAGUES) as LeagueCode[];
  const loaded = await Promise.all(codes.map((c) => fetchLeagueSeasonMerged(c, season, now)));
  return new Map(codes.map((c, i) => [c, loaded[i]]));
}

export async function buildEntityFactSet(
  vertical: string,
  axis: string,
  key: string,
  now: Date = new Date(),
  seasons?: SeasonCache
): Promise<EntityFactSet | null> {
  if (vertical !== FOOTBALL_VERTICAL) return null;
  const parsed = parseKey(key);
  if (!parsed || parsed.axis !== axis) return null;

  const code = leagueCodeOf(parsed.leagueSlug);
  if (!code) return null;

  const season = currentEuropeanSeason(now);
  // fetchLeagueSeasonMerged, KHÔNG fetchLeagueSeason — xem AGENTS.md. Nền JSON
  // trễ hơn lớp phủ .txt tới sáu ngày, và không có gì đỏ lên khi gọi nhầm.
  const s = seasons?.get(code) ?? (await fetchLeagueSeasonMerged(code, season, now));
  const lg = leagueStats(s);
  // Tên giải tiếng Việt, không phải chuỗi của file nguồn: nó đi thẳng vào
  // prompt, và luật 2 buộc model nêu tên giải mỗi lần dùng số cấp giải.
  const base = { vertical, axis, key, leagueName: LEAGUES[code], season, stalenessDays: lg.stalenessDays };

  if (axis === "league") {
    // Trang GIẢI: chỉ số cấp giải CHÍNH LÀ nội dung của nó, nên không lọc.
    const facts = leagueFacts(lg);
    return { ...base, displayName: LEAGUES[code], facts, modelFacts: facts, fingerprint: fingerprintOf(facts, season, LEAGUES[code]) };
  }

  if (axis === "team") {
    const team = s.teams.find((t) => teamSlug(t) === parsed.team);
    if (!team) return null;
    const facts = teamFacts(teamStats(s, team), lg);
    const modelFacts = forModel(facts);
    return { ...base, displayName: team, facts, modelFacts, fingerprint: fingerprintOf(modelFacts, season, team) };
  }

  if (axis === "fixture") {
    const [slugA, slugB] = parsed.pair!;
    const a = s.teams.find((t) => teamSlug(t) === slugA);
    const b = s.teams.find((t) => teamSlug(t) === slugB);
    if (!a || !b) return null;
    const name = `${a} gặp ${b}`;
    const facts = fixtureFacts(fixtureStats(s, a, b), lg);
    const modelFacts = forModel(facts);
    return { ...base, displayName: name, facts, modelFacts, fingerprint: fingerprintOf(modelFacts, season, name) };
  }

  return null;
}

export function renderEntityFactsForPrompt(fs: EntityFactSet): string {
  const lines = fs.modelFacts.map((f) => {
    const scope =
      f.scope === "LEAGUE"
        ? `phạm vi: cấp GIẢI — mô tả toàn bộ ${f.scopeName}, KHÔNG phải riêng ${fs.displayName}`
        : f.scope === "FIXTURE"
          ? `phạm vi: cặp đối đầu ${f.scopeName}`
          : `phạm vi: ĐỘI ${f.scopeName}`;
    // f.display, không phải f.value — xem chú thích của FootballFact.display.
    return `- ${f.label}: ${f.display} [${scope}]`;
  });

  return [
    `Trang: ${fs.displayName}`,
    `Giải: ${fs.leagueName}`,
    `Mùa: ${fs.season}`,
    /**
     * Độ trễ KHÔNG đi vào prompt dưới dạng một con số.
     *
     * Bản đầu có: "cách đây 2 ngày". Model trích lại nó — hợp lý, nó là một
     * con số trong đề bài — và validator từ chối, đúng: `stalenessDays` không
     * phải chỉ số đo được, nó không có trong fact set. Đo 22/9/2026 trên
     * trang đối đầu Fulham/Man Utd: trượt lượt một vì đúng chữ "cách đây 2
     * ngày", đạt lượt hai. Tức MỘT lượt sinh phí cho mỗi trang model làm vậy.
     *
     * Validator không sai, prompt sai: tôi đưa cho model một con số rồi không
     * nói nó không được dùng. Và chỗ đúng của độ trễ vốn không phải văn xuôi —
     * trang tự render `stalenessDays` một cách tất định (brief mục 4.2 đòi
     * đúng thế). Một con số in trong đoạn văn đã cache sẽ đứng yên trong khi
     * độ trễ thật tăng mỗi ngày.
     */
    fs.stalenessDays === null
      ? "Dữ liệu: mùa chưa có trận nào có tỷ số."
      : "Số liệu tính tới trận gần nhất có tỷ số. KHÔNG viết 'cập nhật hôm nay', và KHÔNG nêu " +
        "số ngày đã trôi qua — trang tự hiển thị độ trễ, còn đoạn văn này thì được lưu lại và " +
        "sẽ cũ đi.",
    "",
    "CHỈ SỐ ĐÃ ĐO (những sự kiện duy nhất được phép nêu):",
    ...lines,
  ].join("\n");
}

export interface EntityGenerateOutcome {
  text: string;
  cached: boolean;
  validation: EntityValidationResult;
  factsFingerprint: string;
  facts: FootballFact[];
  attempts: number;
  costUsd: number;
}

/**
 * Trả văn ĐÃ sinh, hoặc null, KHÔNG bao giờ gọi model.
 *
 * Tồn tại vì bài học đã trả giá ở trục địa lý: cách duy nhất để hỏi "trang
 * này có văn chưa" từng là yêu cầu sinh nó, và yêu cầu thì sinh. Một session
 * thăm dò một trang để chạy thử một nhánh đã tiêu tiền thật.
 *
 * Cùng luật cache với đường sinh: vân tay phải khớp, và văn đã lưu được KIỂM
 * LẠI khi đọc chứ không được tin. Luật validator siết dần theo thời gian, nên
 * văn lưu dưới luật cũ phải qua được luật hôm nay.
 */
export async function getCachedEntityInterpretation(
  vertical: string,
  axis: string,
  key: string
): Promise<EntityGenerateOutcome | null> {
  const fs = await buildEntityFactSet(vertical, axis, key);
  if (!fs || fs.modelFacts.length === 0) return null;

  const identity = await prisma.entityIdentity.findUnique({
    where: { vertical_axis_key: { vertical, axis, key } },
    select: { id: true },
  });
  if (!identity) return null;

  const cached = await prisma.aiEntityGeneration.findFirst({
    where: { entityIdentityId: identity.id, factsFingerprint: fs.fingerprint, validationPassed: true },
    orderBy: { createdAt: "desc" },
  });
  if (!cached) return null;

  const recheck = validateEntityText(cached.text, fs.modelFacts, { pageAxis: axis, leagueName: fs.leagueName });
  if (!recheck.passed) return null;

  return {
    text: cached.text,
    cached: true,
    validation: recheck,
    factsFingerprint: fs.fingerprint,
    facts: fs.modelFacts,
    attempts: 0,
    costUsd: 0,
  };
}

/**
 * Văn đã kiểm cho một trang, sinh nếu chưa có.
 *
 * Cache khoá theo VÂN TAY FACT, không theo (vertical, axis, key): fact bóng
 * đá đổi sau MỖI VÒNG ĐẤU, và một đoạn viết cho Arsenal sau 5 trận vẫn đọc
 * trôi chảy sau 6 trận — vẫn sai. Đó là dạng hỏng đáng chống nhất, vì văn bản
 * vẫn tự tin và vẫn đúng ngữ pháp.
 */
export async function getOrGenerateEntityInterpretation(
  vertical: string,
  axis: string,
  key: string
): Promise<EntityGenerateOutcome | null> {
  const fs = await buildEntityFactSet(vertical, axis, key);
  if (!fs) return null;
  // Không fact nào thì KHÔNG sinh. Một trang chưa đá trận nào không có gì để
  // diễn giải, và bắt model viết về một tập rỗng là mời nó bịa.
  if (fs.modelFacts.length === 0) return null;

  const identity = await prisma.entityIdentity.findUnique({
    where: { vertical_axis_key: { vertical, axis, key } },
    select: { id: true },
  });
  if (!identity) return null;

  const cached = await getCachedEntityInterpretation(vertical, axis, key);
  if (cached) return cached;

  const system = entitySystemPrompt(vertical);
  const prompt = renderEntityFactsForPrompt(fs);
  let totalCost = 0;
  let last: EntityValidationResult = { passed: false, issues: [] };
  let lastText = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let result;
    try {
      result = await generateWithClaude({ system, prompt, vertical, zip: null });
    } catch (err) {
      // Sinh cụt/rỗng là MỘT lần thử trượt, không phải sự cố phải nổ ra ngoài:
      // để nó ném xuyên qua sẽ làm một lô 96 đội chết ở đội thứ nhất.
      if (!(err instanceof IncompleteGenerationError)) throw err;
      continue;
    }
    totalCost += result.costUsd;
    lastText = result.text;
    last = validateEntityText(result.text, fs.modelFacts, { pageAxis: axis, leagueName: fs.leagueName });

    // Ghi CẢ bản trượt, kèm lý do. Một bản bị từ chối là bằng chứng về prompt,
    // và vứt nó đi lặng lẽ sẽ giấu mất một vấn đề có hệ thống.
    await prisma.aiEntityGeneration.create({
      data: {
        entityIdentityId: identity.id,
        factsFingerprint: fs.fingerprint,
        prompt,
        text: result.text,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        validationPassed: last.passed,
        validationNotes: last.passed ? null : last.issues.map((i) => `${i.rule}: ${i.detail}`).join(" · "),
      },
    });

    if (last.passed) {
      return {
        text: result.text,
        cached: false,
        validation: last,
        factsFingerprint: fs.fingerprint,
        facts: fs.modelFacts,
        attempts: attempt,
        costUsd: totalCost,
      };
    }
  }

  return {
    text: lastText,
    cached: false,
    validation: last,
    factsFingerprint: fs.fingerprint,
    facts: fs.modelFacts,
    attempts: MAX_ATTEMPTS,
    costUsd: totalCost,
  };
}
