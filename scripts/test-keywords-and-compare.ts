// Tests for the two modules that had none.
//
// Both are pure logic sitting on a hot path, and both fail quietly. The
// keyword functions decide which phrasing a market is scored on — get it wrong
// and the market ranking shifts with no error anywhere. The comparison functions
// decide whether a collection run looks like a change worth reading, and their
// whole substance is edge cases: a metric that appears or vanishes between
// snapshots, a previous value of zero, an average taken over a location set
// that moved underneath it.
//
// Usage: tsx scripts/test-keywords-and-compare.ts

import { applyStateSuffix, renderTemplate, pickBestCandidate } from "../lib/keywords/patterns";
import { computeMetricDeltas, formatPercentChange } from "../lib/collector/compare";
import { assertValidGscProperty } from "../lib/google/search-console";
import { assertValidGa4MeasurementId, assertValidGa4PropertyId } from "../lib/google/analytics-data";
import { explainGoogleApiError } from "../lib/google/service-account";
import { parseSitemapXml, categoriseSitemapUrls } from "../lib/sitemap/count";
import { parseZoneListResponse } from "../lib/cloudflare/zones";
import { normalizeHost, findWebsiteForDomain } from "../lib/publisher/link-domain";
import { deriveWpAdminUrl } from "../lib/wordpress/rest-api";

interface Case {
  name: string;
  expect: string;
  run: () => string;
}

const pt = (locationId: string, metric: string, value: number, unit = "u") => ({ locationId, metric, value, unit });
const delta = (metric: string, current: ReturnType<typeof pt>[], previous: ReturnType<typeof pt>[]) => {
  const d = computeMetricDeltas(current, previous).find((m) => m.metric === metric);
  if (!d) return "KHÔNG CÓ";
  return `n=${d.sampleSize} trước=${d.previousAvg} sau=${d.currentAvg} đổi=${d.percentChange} đáng_kể=${d.significantChangeCount}`;
};

const SITE = "https://atmovingservices.com";

const CASES: Case[] = [
  // --- applyStateSuffix ---
  {
    name: "hậu tố bang: thêm cho thành phố trùng tên, đúng bang cần",
    // Giữ nguyên hoa thường của place, chỉ bang được viết thường — place đi
    // thẳng vào từ khoá hiển thị, còn bang chỉ là hậu tố.
    expect: "Springfield il",
    run: () => applyStateSuffix("Springfield", "IL", { springfield: ["IL", "MO"] }),
  },
  {
    // The measurement decided per (city, state) pair, not per city. A city
    // needing the suffix in one state must not gain it in another.
    name: "hậu tố bang: KHÔNG thêm cho bang không nằm trong danh sách",
    expect: "Springfield",
    run: () => applyStateSuffix("Springfield", "OR", { springfield: ["IL", "MO"] }),
  },
  {
    name: "hậu tố bang: không có trong danh sách -> giữ nguyên",
    expect: "Tulsa",
    run: () => applyStateSuffix("Tulsa", "OK", { springfield: ["IL"] }),
  },
  {
    // The lookup key is lowercased and the state uppercased on both sides.
    // Case coming from a CSV must not silently miss.
    name: "hậu tố bang: khớp bất kể hoa thường ở đầu vào",
    expect: "SPRINGFIELD il",
    run: () => applyStateSuffix("SPRINGFIELD", "il", { springfield: ["IL"] }),
  },

  // --- renderTemplate ---
  {
    name: "template: thay cả {vertical} và {place}",
    expect: "moving services austin",
    run: () => renderTemplate("{vertical} {place}", "moving-services", "austin"),
  },
  {
    // REGRESSION: the vertical arrives as a slug. A hyphen left in place
    // produces "moving-services austin", which is not a phrase anyone types.
    name: "REGRESSION template: dấu gạch ngang trong vertical thành khoảng trắng",
    expect: "solar panel installation dallas",
    run: () => renderTemplate("{vertical} {place}", "solar-panel-installation", "dallas"),
  },
  {
    name: "template: thay TẤT CẢ lần xuất hiện, không chỉ lần đầu",
    expect: "austin movers in austin",
    run: () => renderTemplate("{place} movers in {place}", "moving-services", "austin"),
  },
  {
    name: "template: cắt khoảng trắng thừa hai đầu",
    expect: "roofing miami",
    run: () => renderTemplate("  {vertical} {place}  ", "roofing", "miami"),
  },

  // --- pickBestCandidate ---
  {
    name: "chọn từ khoá: volume cao nhất thắng",
    expect: "b",
    run: () => pickBestCandidate([
      { keyword: "a", searchVolume: 100, cpc: 1, keywordDifficulty: 1 },
      { keyword: "b", searchVolume: 900, cpc: 1, keywordDifficulty: 90 },
    ])!.keyword,
  },
  {
    // A genuine tie means the engine treats them as the same query, so the
    // one that is easier to rank for is strictly better.
    name: "chọn từ khoá: volume bằng nhau -> KD thấp hơn thắng",
    expect: "b",
    run: () => pickBestCandidate([
      { keyword: "a", searchVolume: 500, cpc: 1, keywordDifficulty: 40 },
      { keyword: "b", searchVolume: 500, cpc: 1, keywordDifficulty: 12 },
    ])!.keyword,
  },
  {
    // Determinism matters more than which one wins: the pipeline re-runs, and
    // a choice that flips between runs rewrites market scores for no reason.
    name: "chọn từ khoá: bằng nhau hoàn toàn -> giữ thứ tự template, có thể lặp lại",
    expect: "a",
    run: () => pickBestCandidate([
      { keyword: "a", searchVolume: 500, cpc: 1, keywordDifficulty: 20 },
      { keyword: "b", searchVolume: 500, cpc: 9, keywordDifficulty: 20 },
    ])!.keyword,
  },
  {
    name: "chọn từ khoá: KD = 0 là giá trị thật, phải thắng KD 20",
    expect: "b",
    run: () => pickBestCandidate([
      { keyword: "a", searchVolume: 500, cpc: 1, keywordDifficulty: 20 },
      { keyword: "b", searchVolume: 500, cpc: 1, keywordDifficulty: 0 },
    ])!.keyword,
  },
  {
    name: "chọn từ khoá: danh sách rỗng -> null, không phải ném lỗi",
    expect: "null",
    run: () => String(pickBestCandidate([])),
  },

  // --- computeMetricDeltas ---
  {
    name: "so sánh: trung bình và phần trăm trên tập địa điểm chung",
    expect: "n=2 trước=100 sau=110 đổi=10 đáng_kể=2",
    run: () =>
      delta(
        "m",
        [pt("A", "m", 110), pt("B", "m", 110)],
        [pt("A", "m", 100), pt("B", "m", 100)]
      ),
  },
  {
    // REGRESSION: a location present in only one snapshot must not enter the
    // average. Otherwise a source that gained coverage reports a "change" that
    // is really a change of denominator — which is exactly what NOAA did when
    // it went from 272 to 293 locations.
    name: "REGRESSION so sánh: địa điểm chỉ có ở MỘT phía bị loại khỏi trung bình",
    expect: "n=1 trước=100 sau=100 đổi=0 đáng_kể=0",
    run: () =>
      delta(
        "m",
        [pt("A", "m", 100), pt("MỚI", "m", 9999)],
        [pt("A", "m", 100), pt("CŨ", "m", -9999)]
      ),
  },
  {
    // REGRESSION, documented in the source: zero-to-nonzero used to compute as
    // 0% and never count as significant — hiding precisely the event this
    // comparison exists to surface (a county's first FEMA declaration).
    name: "REGRESSION so sánh: 0 -> khác 0 là ĐÁNG KỂ, không phải 0%",
    expect: "n=1 trước=0 sau=3 đổi=null đáng_kể=1",
    run: () => delta("m", [pt("A", "m", 3)], [pt("A", "m", 0)]),
  },
  {
    name: "so sánh: 0 -> 0 là 0%, không đáng kể, không phải null",
    expect: "n=1 trước=0 sau=0 đổi=0 đáng_kể=0",
    run: () => delta("m", [pt("A", "m", 0)], [pt("A", "m", 0)]),
  },
  {
    name: "so sánh: không có địa điểm chung -> bỏ hẳn chỉ số, không chia cho 0",
    expect: "KHÔNG CÓ",
    run: () => delta("m", [pt("A", "m", 5)], [pt("B", "m", 5)]),
  },
  {
    name: "so sánh: chỉ số chỉ có ở bản mới -> không có delta giả",
    expect: "KHÔNG CÓ",
    run: () => delta("mới", [pt("A", "mới", 5)], [pt("A", "cũ", 5)]),
  },
  {
    // Ngưỡng thật là 10% và so sánh là >=, nên 10,0 KÊU còn 9,9 IM. Kẹp sát
    // hai bên ngưỡng: một ngưỡng chỉ chứng minh được ở một phía thì không
    // chứng minh được gì — nó im với mọi thứ hoặc kêu với mọi thứ cũng vậy.
    name: "so sánh: đổi 9,9% -> IM (ngay dưới ngưỡng)",
    expect: "0",
    run: () => String(computeMetricDeltas([pt("A", "m", 109.9)], [pt("A", "m", 100)])[0].significantChangeCount),
  },
  {
    name: "so sánh: đổi đúng 10,0% -> KÊU (ngưỡng là >=)",
    expect: "1",
    run: () => String(computeMetricDeltas([pt("A", "m", 110)], [pt("A", "m", 100)])[0].significantChangeCount),
  },
  {
    name: "so sánh: GIẢM 12% cũng đáng kể, không chỉ tăng",
    expect: "1",
    run: () => String(computeMetricDeltas([pt("A", "m", 88)], [pt("A", "m", 100)])[0].significantChangeCount),
  },

  // --- assertValidGscProperty ---
  // Verifying through a DNS provider always produces a DOMAIN property, so the
  // person most likely to paste the wrong form is the one who did the setup
  // the better way. The API answers a wrong form with 403 — the same status as
  // a real permissions problem.
  {
    name: "GSC property: dạng Domain hợp lệ -> nhận",
    expect: "ok",
    run: () => { assertValidGscProperty("sc-domain:atmovingservices.com"); return "ok"; },
  },
  {
    name: "GSC property: dạng URL-prefix hợp lệ -> nhận",
    expect: "ok",
    run: () => { assertValidGscProperty("https://atmovingservices.com/"); return "ok"; },
  },
  {
    // The exact mistake this exists to catch: a Domain property addressed the
    // way it looks in a browser.
    name: "REGRESSION GSC property: sc-domain kèm https:// -> từ chối, nêu đúng dạng",
    expect: "từ chối",
    run: () => {
      try { assertValidGscProperty("sc-domain:https://atmovingservices.com"); return "NHẬN NHẦM"; }
      catch (e) { return e instanceof Error && e.message.includes("không kèm https://") ? "từ chối" : `sai lý do: ${e}`; }
    },
  },
  {
    name: "GSC property: tên miền trần -> từ chối và nêu CẢ HAI dạng, không đoán bừa",
    expect: "từ chối",
    run: () => {
      try { assertValidGscProperty("atmovingservices.com"); return "NHẬN NHẦM"; }
      catch (e) {
        const m = e instanceof Error ? e.message : "";
        return m.includes("sc-domain:") && m.includes("https://") ? "từ chối" : `thiếu hướng dẫn: ${m}`;
      }
    },
  },
  {
    name: "GSC property: sc-domain có dấu / -> từ chối",
    expect: "từ chối",
    run: () => {
      try { assertValidGscProperty("sc-domain:atmovingservices.com/blog"); return "NHẬN NHẦM"; }
      catch { return "từ chối"; }
    },
  },
  {
    name: "GSC property: chuỗi rỗng -> từ chối",
    expect: "từ chối",
    run: () => { try { assertValidGscProperty("   "); return "NHẬN NHẦM"; } catch { return "từ chối"; } },
  },

  // --- hai mã GA4 ---
  // Chúng đến từ cùng màn hình, trông cùng chính thức, và làm việc ngược
  // nhau. Dán lộn thì cả hai chiều đều hỏng im lặng, nên mỗi bên phải nhận ra
  // HÌNH DẠNG của bên kia và nói đúng ô cần dán.
  {
    name: "GA4: Measurement ID hợp lệ -> nhận",
    expect: "ok",
    run: () => { assertValidGa4MeasurementId("G-1TL8MDDEJH"); return "ok"; },
  },
  {
    name: "GA4: property ID hợp lệ -> nhận",
    expect: "ok",
    run: () => { assertValidGa4PropertyId("553102895"); return "ok"; },
  },
  {
    // Kiểu dán nhầm tệ nhất: script tải được, trang render bình thường, không
    // lỗi console, sự kiện không đi đâu cả.
    name: "REGRESSION GA4: dán dãy SỐ vào ô Measurement -> từ chối, chỉ đúng ô kia",
    expect: "chỉ đúng ô",
    run: () => {
      try { assertValidGa4MeasurementId("553102895"); return "NHẬN NHẦM"; }
      catch (e) {
        const m = e instanceof Error ? e.message : "";
        return m.includes("GA4 property ID") && m.includes("dán nhầm") ? "chỉ đúng ô" : `thiếu hướng dẫn: ${m}`;
      }
    },
  },
  {
    name: "REGRESSION GA4: dán G- vào ô property ID -> từ chối, chỉ đúng ô kia",
    expect: "chỉ đúng ô",
    run: () => {
      try { assertValidGa4PropertyId("G-1TL8MDDEJH"); return "NHẬN NHẦM"; }
      catch (e) {
        const m = e instanceof Error ? e.message : "";
        return m.includes("Measurement ID") && m.includes("dán nhầm") ? "chỉ đúng ô" : `thiếu hướng dẫn: ${m}`;
      }
    },
  },
  {
    // GA4 hiển thị "properties/553102895" ở vài chỗ trong giao diện.
    name: "GA4: property ID kèm tiền tố properties/ -> từ chối và nêu phần số cần dùng",
    expect: "553102895",
    run: () => {
      try { assertValidGa4PropertyId("properties/553102895"); return "NHẬN NHẦM"; }
      catch (e) {
        const m = e instanceof Error ? e.message : "";
        return m.includes("553102895") && m.includes("thừa tiền tố") ? "553102895" : `thiếu gợi ý: ${m}`;
      }
    },
  },
  {
    name: "GA4: Measurement ID viết thường vẫn nhận (người dùng hay gõ g-)",
    expect: "ok",
    run: () => { assertValidGa4MeasurementId("g-1tl8mddejh"); return "ok"; },
  },
  {
    name: "GA4: chuỗi rác ở ô Measurement -> từ chối",
    expect: "từ chối",
    run: () => { try { assertValidGa4MeasurementId("UA-12345-1"); return "NHẬN NHẦM"; } catch { return "từ chối"; } },
  },

  // --- giải thích lỗi Google ---
  // REGRESSION cho một thông điệp SAI mà tôi tự viết: nó nêu đúng hai nguyên
  // nhân cho 403, và cả hai đều sai ở lần đầu tiên nó kêu. Nguyên nhân thật là
  // cái thứ ba nó không nhắc — API chưa bật trong project — tức request chưa
  // hề tới được Search Console. Thông điệp cũ đẩy người ta đi kiểm lại quyền
  // mà họ đã cấp đúng rồi.
  {
    name: "REGRESSION Google 403: API chưa bật -> nói ĐÚNG là chưa bật, không đổ cho quyền",
    expect: "chưa bật",
    run: () => {
      const body = JSON.stringify({
        error: { code: 403, message: "Google Analytics Data API has not been used in project 441097379236 before or it is disabled. Enable it by visiting ..." },
      });
      const m = explainGoogleApiError(403, body);
      return m.includes("API CHƯA ĐƯỢC BẬT") && m.includes("KHÔNG phải vấn đề quyền") ? "chưa bật" : `sai: ${m.slice(0, 90)}`;
    },
  },
  {
    // 403 thật vì thiếu quyền vẫn phải dẫn người ta đi kiểm quyền — và theo
    // đúng thứ tự, vì bật API là việc phải làm trước.
    name: "Google 403: thiếu quyền thật -> liệt kê thứ tự kiểm, có nhắc bật API trước",
    expect: "có thứ tự",
    run: () => {
      const body = JSON.stringify({ error: { code: 403, message: "User does not have sufficient permission for site." } });
      const m = explainGoogleApiError(403, body);
      return m.includes("(1)") && m.includes("(2)") && m.includes("sufficient permission") ? "có thứ tự" : `sai: ${m.slice(0, 90)}`;
    },
  },
  {
    // Một proxy trả HTML thì không được làm hàm này ném lỗi.
    name: "Google lỗi: body không phải JSON -> vẫn trả thông điệp dùng được",
    expect: "ok",
    run: () => (explainGoogleApiError(500, "<html>Bad Gateway</html>").includes("500") ? "ok" : "thiếu mã lỗi"),
  },

  // --- sitemap ---
  {
    // REGRESSION cho mẫu số. Tử số là "mọi URL GSC báo có impression"; mẫu số
    // TRƯỚC ĐÂY là số bài WordPress — trên site headless thì đó chỉ là blog.
    // Thương của hai thứ đó không phải tỷ lệ của cái gì cả, và nó hiện ra như
    // một phần trăm bình thường.
    name: "REGRESSION sitemap: đếm theo ĐỘ SÂU, trang nội dung khớp số site tự báo",
    expect: "total=186 content=158",
    run: () => {
      const urls = [
        `${SITE}/`,
        `${SITE}/moving-services`,
        `${SITE}/data`,
        `${SITE}/blog`,
        ...Array.from({ length: 24 }, (_, i) => `${SITE}/moving-services/s${i}`),
        ...Array.from({ length: 158 }, (_, i) => `${SITE}/moving-services/ca/city-${i}`),
      ];
      const c = categoriseSitemapUrls(urls, SITE);
      return `total=${urls.length} content=${c.content}`;
    },
  },
  {
    name: "sitemap: hub bang KHÔNG bị tính là trang nội dung",
    expect: "0",
    run: () => String(categoriseSitemapUrls([`${SITE}/moving-services/tx`], SITE).content),
  },
  {
    name: "sitemap: URL có query không làm lệch phân loại",
    expect: "1",
    run: () => String(categoriseSitemapUrls([`${SITE}/moving-services/tx/houston?x=1`], SITE).content),
  },
  {
    // Đọc <loc> mà không nhìn thẻ bao sẽ đếm 12 file sitemap thành 12 trang.
    name: "REGRESSION sitemap: <sitemapindex> nhận ra là INDEX, không phải danh sách trang",
    expect: "index:2",
    run: () => {
      const xml = `<?xml version="1.0"?><sitemapindex xmlns="x"><sitemap><loc>${SITE}/s1.xml</loc></sitemap><sitemap><loc>${SITE}/s2.xml</loc></sitemap></sitemapindex>`;
      const r = parseSitemapXml(xml);
      return `${r.isIndex ? "index" : "urlset"}:${r.locs.length}`;
    },
  },
  {
    name: "sitemap: <urlset> nhận ra là danh sách trang",
    expect: "urlset:2",
    run: () => {
      const xml = `<urlset xmlns="x"><url><loc>${SITE}/a</loc></url><url><loc>${SITE}/b</loc></url></urlset>`;
      const r = parseSitemapXml(xml);
      return `${r.isIndex ? "index" : "urlset"}:${r.locs.length}`;
    },
  },
  {
    name: "sitemap: <loc> có xuống dòng và khoảng trắng vẫn đọc được",
    expect: "1",
    run: () => String(parseSitemapXml(`<urlset><url><loc>\n  ${SITE}/a\n </loc></url></urlset>`).locs.length),
  },

  // --- Cloudflare: tra zone có sẵn ---
  // "Thêm domain" và "tạo zone" không phải một yêu cầu. Một domain đã trỏ về
  // Cloudflare từ trước ĐÃ là zone; xin tạo lại sẽ bị từ chối, và lời từ chối
  // đó từng bị báo như một thất bại cho một domain đang chạy hoàn hảo.
  {
    name: "cloudflare: tìm thấy zone có sẵn -> trả zone",
    expect: "zone123:active",
    run: () => {
      const body = JSON.stringify({
        success: true,
        result: [{ id: "zone123", name: "atmovingservices.com", status: "active", name_servers: ["a.ns", "b.ns"] }],
      });
      const z = parseZoneListResponse(200, body, "atmovingservices.com");
      return z ? `${z.id}:${z.status}` : "null";
    },
  },
  {
    // REGRESSION: mảng RỖNG là một câu trả lời thật ("tài khoản không có zone
    // nào tên đó"), khác hẳn lỗi. Gộp hai thứ lại sẽ báo "Cloudflare từ chối"
    // cho một domain chỉ đơn giản là chưa được thêm.
    name: "REGRESSION cloudflare: mảng rỗng -> null, KHÔNG phải lỗi",
    expect: "null",
    run: () => String(parseZoneListResponse(200, JSON.stringify({ success: true, result: [] }), "x.com")),
  },
  {
    // ?name= là bộ lọc. Nếu nó nới ra, hoặc một proxy bỏ qua nó, thì khớp theo
    // tiền tố sẽ nhận nhầm zone của domain KHÁC — hậu quả là một hàng trỏ vào
    // DNS của người khác.
    name: "REGRESSION cloudflare: khớp CHÍNH XÁC tên, không nhận zone gần giống",
    expect: "null",
    run: () => {
      const body = JSON.stringify({
        success: true,
        result: [{ id: "z", name: "notatmovingservices.com", status: "active", name_servers: [] }],
      });
      return String(parseZoneListResponse(200, body, "atmovingservices.com"));
    },
  },
  {
    name: "cloudflare: success=false -> ném lỗi kèm lời Cloudflare",
    expect: "có lời cloudflare",
    run: () => {
      const body = JSON.stringify({ success: false, result: null, errors: [{ message: "Invalid API token" }] });
      try { parseZoneListResponse(403, body, "x.com"); return "KHÔNG NÉM"; }
      catch (e) { return e instanceof Error && e.message.includes("Invalid API token") ? "có lời cloudflare" : `sai: ${e}`; }
    },
  },
  {
    // Phản hồi list trả MẢNG, còn create/get trả object. Dùng nhầm bộ phân
    // tích sẽ kêu "schema drift" cho một kết quả rỗng hoàn toàn bình thường.
    name: "cloudflare: result là object (không phải mảng) -> báo schema drift",
    expect: "drift",
    run: () => {
      try { parseZoneListResponse(200, JSON.stringify({ success: true, result: {} }), "x.com"); return "KHÔNG NÉM"; }
      catch (e) { return e instanceof Error && e.message.includes("schema drift") ? "drift" : `sai: ${e}`; }
    },
  },
  {
    name: "cloudflare: body không phải JSON -> nêu rõ, không nuốt",
    expect: "không phải JSON",
    run: () => {
      try { parseZoneListResponse(502, "<html>Bad Gateway</html>", "x.com"); return "KHÔNG NÉM"; }
      catch (e) { return e instanceof Error && e.message.includes("không phải JSON") ? "không phải JSON" : `sai: ${e}`; }
    },
  },

  // --- nối Domain <-> Publisher ---
  // Quan hệ được SUY RA từ host chứ không lưu thành khoá ngoại: sự thật đó đã
  // nằm trong cả hai hàng, và hai bản sao của một sự thật thì sẽ lệch nhau.
  {
    name: "nối: khớp domain với website cùng host",
    expect: "AT Moving Services",
    run: () =>
      findWebsiteForDomain("atmovingservices.com", [
        { id: "1", name: "AT Moving Services", url: "https://atmovingservices.com" },
      ])?.name ?? "null",
  },
  {
    // Domain đăng ký ở dạng apex, còn URL website có thể mang www. Coi hai thứ
    // đó là hai site khác nhau sẽ làm mọi domain trông như chưa nối.
    name: "nối: www và apex là CÙNG một site",
    expect: "AT",
    run: () =>
      findWebsiteForDomain("atmovingservices.com", [
        { id: "1", name: "AT", url: "https://www.atmovingservices.com/" },
      ])?.name ?? "null",
  },
  {
    // Subdomain là site KHÁC — nó có property Search Console riêng và số liệu
    // riêng. Khớp theo hậu tố sẽ gán cho domain một website mô tả số liệu
    // không phải của nó.
    name: "REGRESSION nối: subdomain KHÔNG được coi là cùng site",
    expect: "null",
    run: () =>
      String(
        findWebsiteForDomain("atmovingservices.com", [
          { id: "1", name: "Blog", url: "https://blog.atmovingservices.com" },
        ])?.name ?? "null"
      ),
  },
  {
    name: "nối: không có website nào khớp -> null",
    expect: "null",
    run: () => String(findWebsiteForDomain("khac.com", [{ id: "1", name: "X", url: "https://atmovingservices.com" }])?.name ?? "null"),
  },
  {
    name: "nối: chuẩn hoá host bỏ cổng, đường dẫn và chữ hoa",
    expect: "example.com",
    run: () => normalizeHost("HTTPS://WWW.Example.com:8443/mot/duong/dan?x=1"),
  },

  // --- wp-admin ---
  {
    // REGRESSION: suy từ URL CÔNG KHAI sẽ ra https://<site>/wp-admin, mà site
    // headless phục vụ Next.js ở đó và không hề có /wp-admin. Một link trông
    // đúng mà đi tới hư không tệ hơn không có link: nó được bấm, nó hỏng, và
    // cái hỏng đó trông như WordPress chết chứ không như địa chỉ sai.
    name: "REGRESSION wp-admin: suy từ REST base chứ không từ URL công khai",
    expect: "http://127.0.0.1:8090/wp-admin",
    run: () => deriveWpAdminUrl("http://127.0.0.1:8090/wp-json/wp/v2", "https://atmovingservices.com").url,
  },
  {
    name: "wp-admin: host loopback -> đánh dấu chỉ-mở-từ-máy-chủ, kèm lệnh tunnel",
    expect: "serverOnly + tunnel 8090",
    run: () => {
      const r = deriveWpAdminUrl("http://127.0.0.1:8090/wp-json/wp/v2", "https://x.com");
      return r.serverOnly && r.tunnelHint?.includes("8090:127.0.0.1:8090") ? "serverOnly + tunnel 8090" : `sai: ${JSON.stringify(r)}`;
    },
  },
  {
    name: "wp-admin: host công khai -> mở thẳng, không cần tunnel",
    expect: "https://cms.example.com/wp-admin|false",
    run: () => {
      const r = deriveWpAdminUrl("https://cms.example.com/wp-json/wp/v2", "https://example.com");
      return `${r.url}|${r.serverOnly}`;
    },
  },
  {
    // Cắt theo /wp-json chứ không cắt một số đoạn cố định: vài cài đặt proxy
    // REST API ở độ sâu namespace khác, và cắt cứng sẽ ra origin sai cho họ.
    name: "wp-admin: cắt theo /wp-json bất kể độ sâu namespace",
    expect: "https://cms.example.com/wp-admin",
    run: () => deriveWpAdminUrl("https://cms.example.com/wp-json/custom/v3/abc", "https://example.com").url,
  },
  {
    name: "wp-admin: chưa cấu hình REST base -> suy từ URL site",
    expect: "https://example.com/wp-admin",
    run: () => deriveWpAdminUrl(null, "https://example.com/").url,
  },
  {
    name: "wp-admin: IP mạng nội bộ 192.168.x cũng là chỉ-mở-từ-máy-chủ",
    expect: "true",
    run: () => String(deriveWpAdminUrl("http://192.168.1.50:8080/wp-json/wp/v2", "https://x.com").serverOnly),
  },

  // --- formatPercentChange ---
  {
    name: "định dạng: null hiển thị là 'từ 0', không phải 0%",
    expect: "N/A (từ 0)",
    run: () => formatPercentChange(null),
  },
  {
    name: "định dạng: số dương có dấu +",
    expect: "+12.3%",
    run: () => formatPercentChange(12.34),
  },
  {
    name: "định dạng: số âm giữ dấu -, không thêm +",
    expect: "-8.0%",
    run: () => formatPercentChange(-7.95),
  },
  {
    name: "định dạng: đúng 0 hiển thị +0.0%, không phải null",
    expect: "+0.0%",
    run: () => formatPercentChange(0),
  },
];

function main() {
  let passed = 0;
  const failures: string[] = [];
  for (const c of CASES) {
    let got: string;
    try {
      got = c.run();
    } catch (err) {
      got = `ném lỗi: ${err instanceof Error ? err.message : String(err)}`;
    }
    const ok = got === c.expect;
    if (ok) passed++;
    else failures.push(`${c.name}\n    mong đợi: ${c.expect}\n    nhận được: ${got}`);
    console.log(`${ok ? "✓" : "✗"} ${c.name}`);
  }
  console.log();
  if (failures.length > 0) {
    console.log(`${passed}/${CASES.length} test đúng. Hỏng:\n`);
    for (const f of failures) console.log(`  ${f}\n`);
    process.exitCode = 1;
  } else {
    console.log(`${passed}/${CASES.length} test đúng.`);
  }
}

main();
