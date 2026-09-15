import { prisma, assertLocalDatabase } from "@/lib/db/prisma";
import { requireApiKey } from "@/lib/api/auth";
import { createPublisherKey, revokePublisherKey } from "@/lib/settings/api-key";

/**
 * Đo thật, qua Prisma thật, trên database CỤC BỘ.
 *
 * Phần thuần đã có scripts/test-publisher-key.ts. Thứ nó không chứng minh
 * được là mảnh ghép: header có được đọc không, tra prefix có ra hàng không,
 * khoá đã thu hồi có bị chặn không, mốc dùng lần cuối có được ghi không.
 * Toàn bộ những cái đó chỉ sai khi có database ở giữa.
 */

assertLocalDatabase("Phép kiểm này TẠO rồi DỌN dữ liệu tạm, nên");

const TAG = `e2e-key-test-${process.pid}`;
let pass = 0;
const fail: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function req(key: string | null, header: "bearer" | "x-api-key" = "bearer"): Request {
  const headers = new Headers();
  if (key) headers.set(header === "bearer" ? "authorization" : "x-api-key", header === "bearer" ? `Bearer ${key}` : key);
  return new Request("https://hq.example/api/v1/anything", { headers });
}

async function status(r: Response | null): Promise<number> {
  return r ? r.status : 200;
}

async function main() {
  const moving = await prisma.website.create({
    data: {
      name: `${TAG} moving`,
      url: `https://${TAG}-moving.example`,
      vertical: "moving-services",
      gscPropertyUrl: `sc-domain:${TAG}-moving.example`,
      ga4PropertyId: "000000001",
    },
  });
  const attorney = await prisma.website.create({
    data: {
      name: `${TAG} attorney`,
      url: `https://${TAG}-attorney.example`,
      vertical: "auto-accident-attorney",
      gscPropertyUrl: `sc-domain:${TAG}-attorney.example`,
      ga4PropertyId: "000000002",
    },
  });

  const movingKey = await createPublisherKey(moving.id, `${TAG} moving`);
  const attorneyKey = await createPublisherKey(attorney.id, `${TAG} attorney`);
  const legacy = await createPublisherKey(moving.id, `${TAG} legacy`);
  await prisma.publisherApiKey.update({ where: { id: legacy.id }, data: { websiteId: null } });

  // ---- cửa đóng ----
  check("không header → 401", (await status(await requireApiKey(req(null), "no-scope"))) === 401);
  check("khoá bịa → 401", (await status(await requireApiKey(req("pseo_" + "0".repeat(48)), "no-scope"))) === 401);
  check("khoá đúng prefix nhưng sai phần bí mật → 401",
    (await status(await requireApiKey(req(movingKey.key.slice(0, 13) + "f".repeat(35)), "no-scope"))) === 401);

  // ---- cửa mở ----
  check("khoá thật qua Bearer → cho", (await status(await requireApiKey(req(movingKey.key), "no-scope"))) === 200);
  check("khoá thật qua X-Api-Key → cho", (await status(await requireApiKey(req(movingKey.key, "x-api-key"), "no-scope"))) === 200);

  // ---- phạm vi, phần thật sự mới ----
  check("đúng niche → cho", (await status(await requireApiKey(req(movingKey.key), { vertical: "moving-services" }))) === 200);
  const cross = await requireApiKey(req(movingKey.key), { vertical: "auto-accident-attorney" });
  check("KHOÁ SITE 1 ĐỌC NICHE AAA → 403", (await status(cross)) === 403);
  const body = cross ? ((await cross.json()) as { error?: string }) : {};
  check("403 nói rõ khoá thuộc publisher nào", (body.error ?? "").includes(`${TAG} moving`), body.error ?? "");
  check("khoá AAA đọc niche AAA → cho", (await status(await requireApiKey(req(attorneyKey.key), { vertical: "auto-accident-attorney" }))) === 200);
  check("khoá AAA đọc niche moving → 403", (await status(await requireApiKey(req(attorneyKey.key), { vertical: "moving-services" }))) === 403);

  // ---- phạm vi theo host ----
  check("đúng host → cho", (await status(await requireApiKey(req(movingKey.key), { host: `${TAG}-moving.example` }))) === 200);
  check("host có www vẫn là chính nó", (await status(await requireApiKey(req(movingKey.key), { host: `www.${TAG}-moving.example` }))) === 200);
  check("host của publisher khác → 403", (await status(await requireApiKey(req(movingKey.key), { host: `${TAG}-attorney.example` }))) === 403);

  // ---- khoá dùng chung cũ ----
  check("khoá cũ đọc được mọi niche", (await status(await requireApiKey(req(legacy.key), { vertical: "auto-accident-attorney" }))) === 200);
  check("khoá cũ đọc được mọi host", (await status(await requireApiKey(req(legacy.key), { host: "bất-kỳ.example" }))) === 200);

  // ---- mốc dùng lần cuối ----
  await new Promise((r) => setTimeout(r, 400));
  const used = await prisma.publisherApiKey.findUnique({ where: { id: movingKey.id }, select: { lastUsedAt: true } });
  check("xác thực thành công có ghi mốc dùng lần cuối", !!used?.lastUsedAt, "thiếu mốc thì không ai dám thu hồi khoá cũ");

  // ---- thu hồi ----
  await revokePublisherKey(movingKey.id);
  check("KHOÁ ĐÃ THU HỒI → 401", (await status(await requireApiKey(req(movingKey.key), "no-scope"))) === 401);
  check("thu hồi khoá này không đụng khoá kia", (await status(await requireApiKey(req(attorneyKey.key), "no-scope"))) === 200);
  const dead = await prisma.publisherApiKey.findUnique({ where: { id: movingKey.id }, select: { lastUsedAt: true, revokedAt: true } });
  check("thu hồi GIỮ LẠI mốc dùng lần cuối", !!dead?.revokedAt && !!dead?.lastUsedAt, "xoá hàng là xoá mất câu trả lời sau một lần lộ khoá");

  // dọn: chỉ những hàng chính lần chạy này tạo ra, chỉ trên database cục bộ
  await prisma.publisherApiKey.deleteMany({ where: { label: { startsWith: TAG } } });
  await prisma.website.deleteMany({ where: { name: { startsWith: TAG } } });

  console.log(fail.length ? `\n✗ ${fail.length} trượt:\n  ${fail.join("\n  ")}\n` : "");
  console.log(`${pass}/${pass + fail.length} đạt.`);
  process.exitCode = fail.length ? 1 : 0;
}

main()
  .catch(async (e) => {
    await prisma.publisherApiKey.deleteMany({ where: { label: { startsWith: TAG } } });
    await prisma.website.deleteMany({ where: { name: { startsWith: TAG } } });
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
