import { prisma } from "@/lib/db/prisma";
import { recheckAll } from "@/lib/indexing/log";

/**
 * Pipeline đo lại index: chính sách, và cái chạy nó.
 *
 * Thay cho một routine trong sổ tay ("đo lại ngày 26/9 và 3/10"). Routine kiểu
 * đó hỏng theo một cách không để lại dấu vết: người giữ sổ bận, mốc trôi qua,
 * và dữ liệu thiếu đúng khoảng thời gian mà câu hỏi cần. Phép thử Omega hỏi
 * "8 trang đưa vào có Ở LẠI không" — câu đó chỉ trả lời được bằng chuỗi phép
 * đo đều đặn, và một lần bỏ lỡ không đo bù được, vì quá khứ đã trôi.
 *
 * ═══ NHỊP ═══
 *
 * Chính sách nằm ở ĐÂY, không nằm trong timer. Timer chỉ là nhịp tim: nó gọi
 * thường xuyên hơn, và hàm này quyết định đã tới hạn chưa. Nhờ vậy đổi nhịp đo
 * là sửa một hằng số trong kho, không phải ssh vào máy sửa unit — và hai bên
 * không thể nói hai con số khác nhau.
 *
 * 24 giờ: URL Inspection có quota 2000 truy vấn/ngày cho mỗi property, còn ở
 * đây là 30 URL. Quota không phải ràng buộc. Ràng buộc là Google cập nhật
 * trạng thái index theo ngày, nên đo dày hơn một ngày chỉ sinh thêm hàng log
 * giống hệt nhau.
 */
export const RECHECK_INTERVAL_HOURS = 24;

/**
 * Timer gọi mỗi mấy giờ. PHẢI khớp `OnUnitActiveSec` trong
 * deploy/pseo-index-recheck.timer — scripts/test-recheck-schedule.ts đọc cả
 * hai và đỏ khi lệch, nên đây không phải một lời hứa trong chú thích.
 *
 * Dùng để nói "pipeline còn sống không": quá hai nhịp mà không có hàng nào thì
 * timer đã chết, và màn hình phải nói ra thay vì hiện một ngày tháng cũ trông
 * như bình thường.
 */
export const HEARTBEAT_HOURS = 6;

export interface RecheckStatus {
  /** Lần ĐO thật gần nhất (không tính lần bỏ qua). */
  lastRun: { startedAt: Date; checked: number; failed: number; trigger: string; error: string | null } | null;
  /** Hàng gần nhất bất kể loại — nhịp tim của pipeline. */
  lastHeartbeat: Date | null;
  /** Khi nào tới hạn đo tiếp. Null khi chưa đo lần nào. */
  dueAt: Date | null;
  /** Đã quá hạn. Tính Ở ĐÂY chứ không tính trong component: so với Date.now()
   *  lúc render là một phép tính không thuần, và lint của kho này bắt đúng nó. */
  overdue: boolean;
  /** Timer im quá lâu. Khác hẳn "chưa tới hạn". */
  heartbeatStale: boolean;
  /** Không có URL nào để đo — pipeline đúng khi không làm gì. */
  nothingToTrack: boolean;
}

export async function getRecheckStatus(websiteId: string): Promise<RecheckStatus> {
  const [lastRunRow, lastAny, tracked] = await Promise.all([
    prisma.indexRecheckRun.findFirst({
      where: { websiteId, skipped: null },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, checked: true, failed: true, trigger: true, error: true },
    }),
    prisma.indexRecheckRun.findFirst({ where: { websiteId }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.indexSubmission.count({ where: { websiteId } }),
  ]);

  const now = Date.now();
  return {
    lastRun: lastRunRow,
    lastHeartbeat: lastAny?.startedAt ?? null,
    dueAt: lastRunRow ? new Date(lastRunRow.startedAt.getTime() + RECHECK_INTERVAL_HOURS * 3600_000) : null,
    overdue: lastRunRow ? lastRunRow.startedAt.getTime() + RECHECK_INTERVAL_HOURS * 3600_000 < now : true,
    // Hai nhịp, không phải một: một nhịp lỡ vì máy bận reboot là bình thường.
    heartbeatStale: lastAny ? now - lastAny.startedAt.getTime() > 2 * HEARTBEAT_HOURS * 3600_000 : false,
    nothingToTrack: tracked === 0,
  };
}

export interface RunOutcome {
  websiteId: string;
  websiteName: string;
  checked: number;
  failed: number;
  skipped: string | null;
  error: string | null;
}

/**
 * Chạy phép đo cho MỘT site, và ghi lại lần chạy dù kết quả thế nào.
 *
 * `force` cho nút bấm tay: người bấm muốn số liệu BÂY GIỜ, và từ chối họ vì
 * "chưa tới hạn" là biến một cái nút thành một câu đố.
 */
export async function runRecheckFor(
  site: { id: string; name: string; gscPropertyUrl: string },
  opts: { trigger: "scheduled" | "manual"; force?: boolean },
): Promise<RunOutcome> {
  const base = { websiteId: site.id, websiteName: site.name, checked: 0, failed: 0 };

  const tracked = await prisma.indexSubmission.count({ where: { websiteId: site.id } });
  if (tracked === 0) {
    await prisma.indexRecheckRun.create({
      data: { websiteId: site.id, trigger: opts.trigger, skipped: "không có URL nào đang theo dõi", finishedAt: new Date() },
    });
    return { ...base, skipped: "không có URL nào đang theo dõi", error: null };
  }

  if (!site.gscPropertyUrl) {
    await prisma.indexRecheckRun.create({
      data: { websiteId: site.id, trigger: opts.trigger, skipped: "site chưa gắn property Search Console", finishedAt: new Date() },
    });
    return { ...base, skipped: "site chưa gắn property Search Console", error: null };
  }

  if (!opts.force) {
    const last = await prisma.indexRecheckRun.findFirst({
      where: { websiteId: site.id, skipped: null },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    const dueIn = last ? last.startedAt.getTime() + RECHECK_INTERVAL_HOURS * 3600_000 - Date.now() : -1;
    if (dueIn > 0) {
      const reason = `chưa tới hạn, còn ${Math.ceil(dueIn / 3600_000)} giờ`;
      await prisma.indexRecheckRun.create({
        data: { websiteId: site.id, trigger: opts.trigger, skipped: reason, finishedAt: new Date() },
      });
      return { ...base, skipped: reason, error: null };
    }
  }

  const run = await prisma.indexRecheckRun.create({ data: { websiteId: site.id, trigger: opts.trigger } });
  try {
    const { checked, failed } = await recheckAll(site.id, site.gscPropertyUrl);
    await prisma.indexRecheckRun.update({ where: { id: run.id }, data: { checked, failed, finishedAt: new Date() } });
    return { ...base, checked, failed, skipped: null, error: null };
  } catch (err) {
    // Lần chạy GÃY vẫn được ghi. Xoá hàng đi thì màn hình sẽ nói "lần đo gần
    // nhất: hôm kia" và không nói vì sao hôm qua không có gì — tức là đúng
    // kiểu im lặng mà bảng log này được dựng để chặn.
    const message = err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : "lỗi không rõ";
    await prisma.indexRecheckRun.update({ where: { id: run.id }, data: { error: message, finishedAt: new Date() } });
    return { ...base, skipped: null, error: message };
  }
}

/** Mọi site tới hạn. Đây là thứ timer gọi. */
export async function runDueRechecks(): Promise<RunOutcome[]> {
  const sites = await prisma.website.findMany({ select: { id: true, name: true, gscPropertyUrl: true } });
  const out: RunOutcome[] = [];
  // Tuần tự: hai site dùng CHUNG một service account, và bắn song song vào
  // URL Inspection chỉ để tiết kiệm vài giây là cách tự đụng rate limit.
  for (const site of sites) {
    const gscProperty = site.gscPropertyUrl;
    // Site chưa cấu hình GSC property thì KHÔNG đo được — ghi ra một kết quả
    // "skipped" thay vì lặng lẽ bỏ khỏi danh sách. Một site biến mất khỏi báo
    // cáo đọc y hệt một site không có vấn đề gì.
    if (!gscProperty) {
      out.push({
        websiteId: site.id,
        websiteName: site.name,
        checked: 0,
        failed: 0,
        skipped: "chưa cấu hình Search Console property",
        error: null,
      });
      continue;
    }
    out.push(await runRecheckFor({ ...site, gscPropertyUrl: gscProperty }, { trigger: "scheduled" }));
  }
  return out;
}
