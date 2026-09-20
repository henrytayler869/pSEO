import { prisma } from "@/lib/db/prisma";
import { fetchSessionsByHost } from "@/lib/google/analytics-data";

/**
 * Hồi quy phép chặn gtag: có phiên nào báo cáo từ host KHÔNG PHẢI site không.
 *
 * ═══ VÌ SAO KHÔNG PHẢI MỘT PIPELINE LẤY MẪU NHƯ ĐO INDEX ═══
 *
 * Hai việc trông giống nhau và khác nhau ở chỗ quyết định: GSC chỉ nói trạng
 * thái BÂY GIỜ, nên không lấy mẫu đều là mất hẳn quá khứ. GA4 thì TỰ GIỮ lịch
 * sử theo ngày — nhìn muộn ba tuần vẫn thấy đủ ba tuần. Nên ở đây việc chạy
 * định kỳ chỉ mua được một thứ: BIẾT SỚM. Không mua thêm bằng chứng nào.
 *
 * Vì vậy hàm kiểm là thứ chính và nó tính trực tiếp từ GA4 mỗi lần màn hình
 * mở; bản chạy theo lịch ghi thêm một dòng để câu "kiểm lần cuối lúc nào" có
 * câu trả lời khi không ai mở màn hình.
 *
 * ═══ MỐC ═══
 *
 * Phép chặn vá ngày 19/9/2026 (pseo-publisher #66, #70). Trước mốc đó ĐÃ CÓ
 * đúng một phiên localhost — ngày 15/9, atmovingservices.com — và nó là lịch
 * sử đã biết, không phải hồi quy. Một phép kiểm báo động vì nó sẽ kêu mãi mãi,
 * và một cảnh báo kêu mãi mãi là một cảnh báo bị tắt.
 *
 * Nên chỉ tính từ mốc trở đi. Dòng nào có ngày >= mốc là MỚI, và mới nghĩa là
 * còn một đường bắn chưa bịt.
 */
export const GTAG_FIX_DATE = "20260919";

export interface HostLeak {
  host: string;
  /** YYYYMMDD */
  date: string;
  sessions: number;
}

export interface HostLeakResult {
  ok: boolean;
  /** Host mà site ĐƯỢC PHÉP báo cáo từ đó. */
  expectedHost: string;
  leaks: HostLeak[];
  /** Tổng phiên rò, để nói một câu ngắn. */
  leakedSessions: number;
  /** Số ngày đã quét. */
  days: number;
}

/** "https://www.a.com/" -> "a.com". GA4 trả hostName trần, không scheme. */
function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(":")[0];
}

export async function checkHostLeak(
  site: { url: string; ga4PropertyId: string },
  days = 28,
): Promise<HostLeakResult> {
  const expectedHost = normalizeHost(site.url);
  const rows = await fetchSessionsByHost(site.ga4PropertyId, days);

  const leaks = rows
    .filter((r) => normalizeHost(r.hostName) !== expectedHost)
    // Mốc so bằng CHUỖI: GA4 trả YYYYMMDD, và so chuỗi trên định dạng đó cho
    // đúng thứ tự mà không phải dựng Date rồi lạc múi giờ. GA4 báo theo múi
    // giờ của property, không phải UTC, nên một phép đổi sang Date ở đây sẽ
    // lệch một ngày ở đúng hai đầu khoảng — chỗ duy nhất câu trả lời đổi.
    .filter((r) => r.date >= GTAG_FIX_DATE)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((r) => ({ host: r.hostName, date: r.date, sessions: r.sessions }));

  return {
    ok: leaks.length === 0,
    expectedHost,
    leaks,
    leakedSessions: leaks.reduce((sum, l) => sum + l.sessions, 0),
    days,
  };
}

/** Câu một dòng cho log và cho bảng ScheduledCheck. */
export function describeHostLeak(r: HostLeakResult): string {
  if (r.ok) return `không phiên nào từ host lạ trong ${r.days} ngày (kể từ mốc vá ${GTAG_FIX_DATE})`;
  const top = r.leaks
    .slice(0, 3)
    .map((l) => `${l.host} ngày ${l.date} (${l.sessions} phiên)`)
    .join(", ");
  return `RÒ: ${r.leakedSessions} phiên từ host không phải ${r.expectedHost} — ${top}${r.leaks.length > 3 ? ", …" : ""}`;
}

export const HOST_LEAK_CHECK = "gtag-host-leak";

/** Chạy phép kiểm cho một site và GHI LẠI, kể cả khi sạch. */
export async function runHostLeakCheck(site: {
  id: string;
  name: string;
  url: string;
  ga4PropertyId: string;
}): Promise<{ websiteName: string; ok: boolean; detail: string }> {
  let ok = false;
  let detail: string;
  try {
    const result = await checkHostLeak(site);
    ok = result.ok;
    detail = describeHostLeak(result);
  } catch (err) {
    // Hỏi GA4 không được KHÔNG phải là "sạch". Ghi ok=false với lý do, vì một
    // phép kiểm không chạy được mà hiện màu xanh là thứ tệ hơn không có phép
    // kiểm nào.
    detail = `không hỏi được GA4: ${err instanceof Error ? err.message.split("\n")[0].slice(0, 160) : "lỗi không rõ"}`;
  }
  await prisma.scheduledCheck.create({ data: { websiteId: site.id, kind: HOST_LEAK_CHECK, ok, detail } });
  return { websiteName: site.name, ok, detail };
}

export async function runAllHostLeakChecks() {
  const sites = await prisma.website.findMany({ select: { id: true, name: true, url: true, ga4PropertyId: true } });
  const out = [];
  // Tuần tự: cùng một service account cho mọi property.
  for (const site of sites) out.push(await runHostLeakCheck(site));
  return out;
}

export interface LastCheck {
  ok: boolean;
  detail: string;
  checkedAt: Date;
}

export async function getLastHostLeakCheck(websiteId: string): Promise<LastCheck | null> {
  return prisma.scheduledCheck.findFirst({
    where: { websiteId, kind: HOST_LEAK_CHECK },
    orderBy: { checkedAt: "desc" },
    select: { ok: true, detail: true, checkedAt: true },
  });
}
