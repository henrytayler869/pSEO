import { prisma } from "../db/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Chọn website cho một script chạy tay.
 *
 * Trước đây mọi script gọi `prisma.website.findFirst()`. Với đúng một site
 * thì không sai bao giờ. Với hai site thì mọi script lặng lẽ chạy trên một
 * site tuỳ ý — và `findFirst` không kèm `orderBy` thì Postgres không bảo
 * đảm thứ tự, nên nó còn có thể đổi giữa hai lần chạy trên cùng dữ liệu.
 *
 * Hậu quả không đồng đều. `index-priority` in nhầm bảng thì thấy ngay.
 * `generate-cluster-text` đọc inventory của site sai rồi TIÊU TIỀN sinh
 * đoạn cho cụm của niche khác, và đoạn đó vẫn hợp lệ về mặt kiểm tra —
 * số thật, nguồn thật, chỉ là của nơi khác.
 *
 * Nên khi có từ hai site trở lên, hàm này TỪ CHỐI đoán. Một script dừng
 * lại và hỏi rẻ hơn nhiều so với một script đoán đúng chín lần.
 */
export interface ResolveSiteOptions {
  /** argv của script; tìm `--site <host>`. */
  argv?: string[];
  /** Chỉ xét site của niche này. Dùng cho script vốn chỉ có nghĩa với một niche. */
  vertical?: string;
  select?: Prisma.WebsiteSelect;
}

export class SiteAmbiguousError extends Error {}

function hostOf(value: string): string {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host.replace(/^www\./, "");
  } catch {
    return value.replace(/^www\./, "").replace(/\/+$/, "");
  }
}

/**
 * Trả về website đã chọn, hoặc ném lỗi nêu rõ phải làm gì.
 *
 * Không nhận `--site` thì: đúng một site → dùng nó; nhiều hơn → ném lỗi kèm
 * danh sách. Đây là chỗ duy nhất trong repo được phép quyết định "site nào",
 * để lần thêm site thứ ba không phải sửa mười chỗ.
 */
export async function resolveSite<T = { id: string; url: string; vertical: string }>(
  opts: ResolveSiteOptions = {}
): Promise<T> {
  const argv = opts.argv ?? process.argv;
  const flagIdx = argv.indexOf("--site");
  const wanted = flagIdx >= 0 ? argv[flagIdx + 1] : process.env.PSEO_SITE;

  const where: Prisma.WebsiteWhereInput = opts.vertical ? { vertical: opts.vertical } : {};
  const sites = await prisma.website.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: { id: true, url: true, vertical: true, ...(opts.select ?? {}) },
  });

  return chooseSite(sites, wanted, opts.vertical) as T;
}

export interface SiteRow {
  url: string;
  vertical: string;
}

/**
 * Phần QUYẾT ĐỊNH, tách khỏi phần truy vấn để kiểm được.
 *
 * Nhánh quan trọng nhất của hàm này — từ chối khi có nhiều site — không thể
 * chạm tới trên máy chỉ có một site. Để nó nằm chung với truy vấn Prisma
 * nghĩa là nó ship mà chưa chạy lần nào, đúng cái bệnh mà cả helper này
 * sinh ra để chữa. scripts/test-resolve-site.ts chứng minh từng nhánh.
 */
export function chooseSite<T extends SiteRow>(sites: T[], wanted: string | undefined, vertical?: string): T {
  const scope = vertical ? ` cho niche "${vertical}"` : "";

  if (sites.length === 0) {
    throw new SiteAmbiguousError(`Không có website nào${scope}. Thêm ở /publisher trước.`);
  }

  if (wanted) {
    const target = hostOf(wanted);
    const hit = sites.filter((s) => hostOf(s.url) === target);
    if (hit.length === 1) return hit[0];
    // Không rơi về "lấy cái đầu". Người dùng đã nêu rõ một site; không tìm
    // thấy nghĩa là họ gõ sai hoặc site chưa được thêm — chạy trên site khác
    // là làm đúng việc ở sai nơi.
    throw new SiteAmbiguousError(
      `Không có site nào khớp "${wanted}"${scope}.\nCó: ${sites.map((s) => hostOf(s.url)).join(", ")}`
    );
  }

  if (sites.length === 1) return sites[0];

  throw new SiteAmbiguousError(
    `Có ${sites.length} website${scope} — phải nêu rõ chạy trên site nào.\n` +
      sites.map((s) => `  --site ${hostOf(s.url)}   (${s.vertical})`).join("\n")
  );
}

/** In lỗi chọn site cho gọn rồi thoát 1, thay vì đổ stack trace. */
export function reportSiteError(err: unknown): boolean {
  if (!(err instanceof SiteAmbiguousError)) return false;
  console.error(err.message);
  process.exitCode = 1;
  return true;
}
