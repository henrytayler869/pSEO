// Registers a website in Publisher, and optionally installs the Google
// service-account key, from the command line.
//
// Exists because the production database is reachable from the server and not
// from a laptop, so the alternative was someone typing INSERT statements into
// psql against live data. This runs the SAME validators the form does — a
// measurement ID in the property field is rejected here exactly as it is in the
// UI — and it is idempotent, so a re-run after a typo corrects the row instead
// of failing on the unique constraint or creating a second one.
//
// Usage:
//   tsx scripts/connect-website.ts \
//     --name "AT Moving Services" \
//     --url https://atmovingservices.com \
//     --gsc sc-domain:atmovingservices.com \
//     --ga4-property 553102895 \
//     --ga4-measurement G-1TL8MDDEJH \
//     [--service-account-file /path/to/key.json] \
//     [--revalidate-secret-file /path/to/secret.txt]
//
// The two secret-bearing options take a FILE PATH, never a value. A secret
// passed as an argument is visible in `ps` output to every user on the machine
// and lands in the shell history of whoever ran it; a file path is neither.

import fs from "node:fs";
import { prisma } from "../lib/db/prisma";
import { assertValidGscProperty } from "../lib/google/search-console";
import { assertValidGa4MeasurementId, assertValidGa4PropertyId } from "../lib/google/analytics-data";
import { deriveWpApiBaseUrl } from "../lib/wordpress/rest-api";
import { saveServiceAccountKey, getServiceAccountStatus } from "../lib/google/service-account";

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
  const name = arg("--name");
  const url = arg("--url");
  const gsc = arg("--gsc");
  const ga4Property = arg("--ga4-property");
  const ga4Measurement = arg("--ga4-measurement");
  const serviceAccountFile = arg("--service-account-file");
  const revalidateSecretFile = arg("--revalidate-secret-file");

  if (!name || !url || !gsc || !ga4Property) {
    console.error("Thiếu tham số. Cần --name, --url, --gsc, --ga4-property. Xem phần Usage ở đầu file.");
    process.exit(1);
  }

  // Validated before anything is written, so a bad value costs nothing and a
  // half-configured site never exists.
  assertValidGscProperty(gsc);
  assertValidGa4PropertyId(ga4Property);
  if (ga4Measurement) assertValidGa4MeasurementId(ga4Measurement);

  if (serviceAccountFile) {
    const raw = fs.readFileSync(serviceAccountFile, "utf-8");
    const { client_email } = await saveServiceAccountKey(raw);
    console.log(`Service account đã lưu: ${client_email}`);
  }
  const saStatus = await getServiceAccountStatus();
  if (!saStatus.configured) {
    console.warn(
      "CẢNH BÁO: chưa có Google Service Account trong database này — website sẽ kết nối được nhưng mọi số liệu GSC/GA4 sẽ báo lỗi cho tới khi có key."
    );
  }

  const revalidateSecret = revalidateSecretFile
    ? readSecretFile(revalidateSecretFile, "--revalidate-secret-file")
    : undefined;

  // Keyed on gscPropertyUrl because that is the column carrying the unique
  // constraint. Upsert rather than create: re-running this after fixing a typo
  // should converge on the right row, not fail or duplicate.
  const website = await prisma.website.upsert({
    where: { gscPropertyUrl: gsc },
    create: {
      name,
      url,
      gscPropertyUrl: gsc,
      ga4PropertyId: ga4Property,
      ga4MeasurementId: ga4Measurement || null,
      wpApiBaseUrl: deriveWpApiBaseUrl(url),
      ...(revalidateSecret ? { revalidateSecret } : {}),
    },
    update: {
      name,
      url,
      ga4PropertyId: ga4Property,
      ga4MeasurementId: ga4Measurement || null,
      // Only overwritten when a new one was supplied. Passing nothing must not
      // silently erase a secret that is already working.
      ...(revalidateSecret ? { revalidateSecret } : {}),
    },
  });

  console.log(`\nĐã kết nối "${website.name}" (id ${website.id})`);
  console.log(`  url              ${website.url}`);
  console.log(`  gsc              ${website.gscPropertyUrl}`);
  console.log(`  ga4 property     ${website.ga4PropertyId}`);
  console.log(`  ga4 measurement  ${website.ga4MeasurementId ?? "(chưa đặt)"}`);
  console.log(`  revalidate secret ${website.revalidateSecret ? "đã đặt" : "(chưa đặt — site sẽ tự lấy khi cache hết hạn)"}`);
  console.log(`  wp api base      ${website.wpApiBaseUrl ?? "(mặc định)"}`);
  console.log("\nKiểm lại từ bên ngoài: https://<host>/api/version — analyticsSource phải là \"hq\".");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nTHẤT BẠI: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
