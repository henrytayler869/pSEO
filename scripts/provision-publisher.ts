import { writeFileSync, existsSync, readFileSync, chmodSync } from "fs";
import path from "path";
import { prisma } from "@/lib/db/prisma";
import { connectWebsiteAction } from "@/app/publisher/actions";
import { createPublisherKey } from "@/lib/settings/api-key";
import { pushKeyToSite } from "@/lib/publisher/push-key";

/**
 * Nối một publisher MỚI vào Head Quarter và trao khoá đầu tiên cho nó.
 *
 *   node_modules/.bin/tsx scripts/provision-publisher.ts \
 *     --name "The Accident Record" \
 *     --url https://theaccidentrecord.com \
 *     --vertical auto-accident-attorney \
 *     --ga4 553102895 \
 *     --repo /Users/user/Documents/theaccidentrecord
 *
 * Vì sao cần script riêng thay vì dùng nút "Tạo khoá": nút đó ĐẨY khoá sang
 * site, và một publisher chưa deploy thì chưa có chỗ để đẩy tới. Khoá đầu
 * tiên phải đi vào `.env` của repo; từ khoá thứ hai trở đi mới là một nút.
 *
 * KHÔNG IN KHOÁ — không stdout, không log, không tin nhắn. Nó chỉ tồn tại
 * trong bộ nhớ tiến trình này giữa lúc sinh ra và lúc ghi xuống file, và
 * file đó phải nằm trong .gitignore (script từ chối nếu không).
 *
 * Không ghi đè `.env` đang có: một publisher đang chạy có thể có nhiều biến
 * ở đó, và mất chúng là mất cấu hình không lấy lại được. Script chỉ THÊM
 * dòng HQ_API_KEY, và từ chối nếu dòng đó đã tồn tại.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function need(name: string): string {
  const v = arg(name);
  if (!v) {
    console.error(`✗ Thiếu --${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const name = need("name");
  const url = need("url");
  const vertical = need("vertical");
  const ga4 = need("ga4");
  const repo = need("repo");
  const gsc = arg("gsc") ?? `sc-domain:${new URL(url).hostname.replace(/^www\./, "")}`;

  const envPath = path.join(repo, ".env");

  // Kiểm ĐIỀU KIỆN GHI TRƯỚC khi tạo bất cứ thứ gì trong database. Sinh khoá
  // rồi mới phát hiện không ghi được là để lại một khoá không ai cầm — HQ chỉ
  // lưu băm nên không lấy lại được, chỉ còn cách thu hồi.
  if (!existsSync(repo)) {
    console.error(`✗ Không có thư mục ${repo}`);
    process.exit(1);
  }
  const gitignore = path.join(repo, ".gitignore");
  const ignored =
    existsSync(gitignore) &&
    readFileSync(gitignore, "utf-8")
      .split("\n")
      .some((l) => l.trim() === ".env" || l.trim() === "*.env" || l.trim() === ".env*");
  if (!ignored) {
    console.error(`✗ ${gitignore} không chặn .env — từ chối ghi bí mật vào một file có thể bị commit.`);
    process.exit(1);
  }
  if (existsSync(envPath) && /^HQ_API_KEY=/m.test(readFileSync(envPath, "utf-8"))) {
    console.error(`✗ ${envPath} đã có HQ_API_KEY. Không ghi đè — xoá dòng đó trước nếu thật sự muốn thay.`);
    process.exit(1);
  }

  // --- nối website, qua đúng action mà UI dùng (đầy đủ kiểm tra của nó) ---
  const existing = await prisma.website.findFirst({ where: { url }, select: { id: true } });
  let websiteId: string;

  if (existing) {
    console.log(`Website đã có trong HQ, dùng lại: ${existing.id}`);
    websiteId = existing.id;
  } else {
    const fd = new FormData();
    fd.set("name", name);
    fd.set("url", url);
    fd.set("vertical", vertical);
    fd.set("ga4PropertyId", ga4);
    fd.set("gscPropertyUrl", gsc);
    const res = await connectWebsiteAction({ ok: false, message: "" }, fd);
    if (!res.ok) {
      console.error(`✗ Nối website thất bại: ${res.message}`);
      process.exit(1);
    }
    console.log(`✓ ${res.message}`);
    websiteId = (await prisma.website.findFirstOrThrow({ where: { url }, select: { id: true } })).id;
  }

  const site = await prisma.website.findUniqueOrThrow({
    where: { id: websiteId },
    select: { url: true, vertical: true, revalidateSecret: true },
  });

  // --- sinh khoá ---
  const { key } = await createPublisherKey(websiteId, "khoá đầu tiên, ghi vào .env của repo");
  console.log(`\nĐã sinh khoá ${key.slice(0, 13)}…  (phần còn lại không in ra)`);

  // --- thử ĐẨY trước; chỉ ghi file khi site chưa nhận được ---
  const push = await pushKeyToSite(site, key);
  if (push.ok) {
    console.log(`✓ ${push.detail}`);
    console.log("  Site đã deploy và nhận được khoá, nên KHÔNG ghi .env — nơi đó sẽ thành một bản sao cũ.");
    return;
  }
  console.log(`  Chưa đẩy sang site được (bình thường với site chưa deploy): ${push.detail}`);

  // --- ghi vào .env ---
  const prev = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const sep = prev && !prev.endsWith("\n") ? "\n" : "";
  writeFileSync(envPath, `${prev}${sep}HQ_API_KEY=${key}\n`, { encoding: "utf-8", mode: 0o600 });
  chmodSync(envPath, 0o600);

  const back = readFileSync(envPath, "utf-8");
  if (!back.includes(`HQ_API_KEY=${key}`)) {
    console.error("✗ Ghi xong nhưng đọc lại không khớp — khoá CHƯA tới nơi.");
    process.exit(1);
  }

  console.log(`✓ Đã ghi HQ_API_KEY vào ${envPath} (chmod 600), đọc lại khớp.`);
  console.log(`  Khoá chỉ đọc được niche "${site.vertical}".`);
  console.log("  Khi site deploy xong và có /api/hq-key, mọi lần xoay khoá sau là một nút bấm.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
