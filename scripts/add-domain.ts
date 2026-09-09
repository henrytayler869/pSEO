// Registers a domain from the command line, importing its Cloudflare zone if
// one already exists.
//
// The counterpart to scripts/connect-website.ts, and it exists for the same
// reason: the production database is reachable from the server and not from a
// laptop, so the alternative is someone typing INSERT statements against live
// data.
//
// Runs the SAME path as the UI — adopt an existing zone, create only when there
// is nothing to adopt — so a domain added here and a domain added through the
// form end up identical. Idempotent: re-running corrects the row instead of
// failing on the unique constraint.
//
// Usage:
//   tsx scripts/add-domain.ts \
//     --name atmovingservices.com \
//     [--vertical moving-services] \
//     [--cloudflare-token-file /path/to/token.txt] \
//     [--cloudflare-account-file /path/to/account-id.txt]
//
// The credential options take a FILE PATH, never a value. A secret passed as an
// argument shows up in `ps` for every user on the machine and stays in the
// shell history of whoever ran it.

import fs from "node:fs";
import { prisma } from "../lib/db/prisma";
import { setCredentials, getCredential } from "../lib/settings/credentials";
import { createCloudflareZone, findCloudflareZoneByName, CloudflareApiError } from "../lib/cloudflare/zones";
import { getTrafficVerticalSummaries } from "../lib/queries/traffic-research";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function readSecretFile(path: string, label: string): string {
  const value = fs.readFileSync(path, "utf-8").trim();
  if (!value) throw new Error(`${label}: file ${path} rỗng.`);
  return value;
}

async function main() {
  const name = arg("--name")?.trim().toLowerCase();
  const vertical = arg("--vertical")?.trim() || null;
  const tokenFile = arg("--cloudflare-token-file");
  const accountFile = arg("--cloudflare-account-file");

  if (!name) {
    console.error("Thiếu --name. Xem phần Usage ở đầu file.");
    process.exit(1);
  }

  // Validated against the same list the dropdown offers, so a value typed here
  // cannot be one the UI would refuse.
  if (vertical) {
    const known = (await getTrafficVerticalSummaries()).map((n) => n.vertical);
    if (!known.includes(vertical)) {
      throw new Error(
        `Niche "${vertical}" chưa được nghiên cứu. Đang có: ${known.length > 0 ? known.join(", ") : "(chưa niche nào)"}.`
      );
    }
  }

  const updates: Record<string, string> = {};
  if (tokenFile) updates.CLOUDFLARE_API_TOKEN = readSecretFile(tokenFile, "--cloudflare-token-file");
  if (accountFile) updates.CLOUDFLARE_ACCOUNT_ID = readSecretFile(accountFile, "--cloudflare-account-file");
  if (Object.keys(updates).length > 0) {
    await setCredentials(updates);
    console.log(`Đã lưu credential: ${Object.keys(updates).join(", ")}`);
  }

  const apiToken = await getCredential("CLOUDFLARE_API_TOKEN");
  const accountId = await getCredential("CLOUDFLARE_ACCOUNT_ID");
  if (!apiToken || !accountId) {
    throw new Error(
      "Database này chưa có CLOUDFLARE_API_TOKEN và/hoặc CLOUDFLARE_ACCOUNT_ID. " +
        "Truyền --cloudflare-token-file / --cloudflare-account-file, hoặc dán ở trang Cài đặt."
    );
  }

  // Adopt before create. A domain already pointed at Cloudflare IS a zone, and
  // asking to create it again is refused — a refusal that says nothing about
  // the domain and everything about the question being wrong.
  let zoneId: string;
  let status: string;
  let nameServers: string[];
  let imported: boolean;
  try {
    const existing = await findCloudflareZoneByName(name, apiToken);
    const zone = existing ?? (await createCloudflareZone(name, apiToken, accountId));
    imported = existing !== null;
    ({ id: zoneId, status, nameServers } = zone);
  } catch (err) {
    const message = err instanceof CloudflareApiError || err instanceof Error ? err.message : String(err);
    // The row is still written, with the error on it — same as the UI. A domain
    // that failed to reach Cloudflare is a thing to see and retry, not a thing
    // to lose.
    await prisma.domain.upsert({
      where: { name },
      create: { name, relevantVertical: vertical, cloudflareError: message, lastCheckedAt: new Date() },
      update: { relevantVertical: vertical, cloudflareError: message, lastCheckedAt: new Date() },
    });
    throw new Error(`Đã lưu "${name}" nhưng Cloudflare thất bại: ${message}`);
  }

  const domain = await prisma.domain.upsert({
    where: { name },
    create: {
      name,
      relevantVertical: vertical,
      cloudflareZoneId: zoneId,
      cloudflareStatus: status,
      nameServers,
      cloudflareError: null,
      lastCheckedAt: new Date(),
    },
    update: {
      relevantVertical: vertical,
      cloudflareZoneId: zoneId,
      cloudflareStatus: status,
      nameServers,
      cloudflareError: null,
      lastCheckedAt: new Date(),
    },
  });

  console.log(`\n${imported ? "Đã NHẬP zone có sẵn" : "Đã TẠO zone mới"} cho "${domain.name}"`);
  console.log(`  zone id      ${domain.cloudflareZoneId}`);
  console.log(`  status       ${domain.cloudflareStatus}`);
  console.log(`  nameservers  ${domain.nameServers.join(", ")}`);
  console.log(`  niche        ${domain.relevantVertical ?? "(chưa gắn)"}`);
  if (imported) {
    console.log("\nZone đã tồn tại từ trước — KHÔNG tạo mới, KHÔNG đụng gì tới DNS đang chạy.");
  } else {
    console.log("\nZone mới — cần trỏ nameserver tại registrar sang hai địa chỉ ở trên.");
  }

  // The Domain <-> Publisher link is derived from the host, so this reports
  // what the UI will show rather than asking anyone to go and look.
  const websites = await prisma.website.findMany({ select: { id: true, name: true, url: true } });
  const { findWebsiteForDomain } = await import("../lib/publisher/link-domain");
  const linked = findWebsiteForDomain(domain.name, websites);
  console.log(
    linked
      ? `  Publisher    đã nối: "${linked.name}" (${linked.url})`
      : `  Publisher    chưa nối — chưa có website nào trong Publisher dùng host này`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nTHẤT BẠI: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
