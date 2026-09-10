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
//     --vertical moving-services \
//     [--wp-username admin --wp-app-password-file /run/secrets/wp-app-pw] \
//     --gsc sc-domain:atmovingservices.com \
//     --ga4-property 553102895 \
//     --ga4-measurement G-1TL8MDDEJH \
//     [--wp-api-base http://127.0.0.1:8090/wp-json/wp/v2] \
//     [--service-account-file /path/to/key.json] \
//     [--revalidate-secret-file /path/to/secret.txt]
//
// The secret-bearing options take a FILE PATH, never a value. A secret passed
// as an argument is visible in `ps` output to every user on the machine and
// lands in the shell history of whoever ran it; a file path is neither.
//
// WHERE --wp-app-password-file COMES FROM
//
// Not from someone opening wp-admin. The provisioning side mints it, writes it
// to a file, and passes the path here — so a new publisher arrives with write
// access already working and nobody types a password anywhere.
//
// Measured on the VPS 2026-09-10 by the session that administers it:
//
//   `wp` is NOT in the wordpress:6-php8.3-apache image (command -v wp -> empty),
//   so `docker exec atms-wp wp ...` does not work. The compose file already
//   carries a `wpcli` service (image wordpress:cli, profiles: ["cli"]), and
//   that one has WP-CLI 2.12.0 and reads the real WordPress.
//
//   docker compose --profile cli run --rm -T wpcli \
//     user application-password create admin "Head Quarter" --porcelain \
//     < /dev/null > /run/secrets/wp-app-pw
//
// THE `< /dev/null` IS LOAD-BEARING. `docker compose run` reads stdin even
// with -T, so the first wpcli command in a heredoc or an ssh here-doc swallows
// the REST OF THE SCRIPT. The commands after it vanish with no error and no
// bad exit code — the VPS session hit exactly this: four probe lines, only the
// first printed, three silently gone. Adding `< /dev/null` to every wpcli call
// fixed it.
//
// That failure mode is why this is written down rather than left to be
// rediscovered: nothing about it looks like a failure while it is happening.
//
// AND MINTING IS NOT ENOUGH — WordPress refuses Application Passwords over
// plain HTTP
//
// `wp_is_application_passwords_available()` returns false when `is_ssl()` is
// false. HQ reaches WordPress at http://127.0.0.1:8090, so the loopback path —
// the safest one — is exactly the path WordPress disables. Measured with a real
// minted credential on 2026-09-10: posts?context=edit -> 401
// rest_forbidden_context, users/me -> 401 rest_not_logged_in.
//
// A credential can therefore be SAVED and UNUSABLE, and those are two different
// states. The measurement that tells them apart is context=edit returning 200
// with content.raw rather than 400/401 — not "the column has a value".
//
// The fix belongs in a must-use plugin in the PUBLISHER's repo (mounted at
// wp-content/mu-plugins), filtering wp_is_application_passwords_available.
// NOT in WORDPRESS_CONFIG_EXTRA: wp-config.php runs before wp-settings.php, so
// `add_filter` does not exist yet there.
//
// Two hypotheses that look right and are not, both measured false, both worth
// naming so the next person does not spend a day on them:
//
//   1. "Apache strips the Authorization header." It does not — .htaccess line 4
//      carries it into PHP and mod_rewrite is enabled.
//   2. "Scope the filter to REMOTE_ADDR === 127.0.0.1." That never matches.
//      The port is published as 127.0.0.1:8090:80, so the container sees the
//      bridge gateway (measured: 172.19.0.1), and mod_remoteip — enabled in the
//      image, trusting 172.16.0.0/12 — rewrites REMOTE_ADDR from
//      X-Forwarded-For whenever that header is present.
//
// Hard-coding 172.19.0.1 fails silently too: Docker allocates it, and a
// `compose down -v` or a renamed project can move the subnet. The property that
// actually separates the two paths is whether nginx put an X-Forwarded-For on
// the request, so that is what the filter should read.

import fs from "node:fs";
import { prisma } from "../lib/db/prisma";
import { assertValidGscProperty } from "../lib/google/search-console";
import { assertValidGa4MeasurementId, assertValidGa4PropertyId } from "../lib/google/analytics-data";
import { deriveWpApiBaseUrl } from "../lib/wordpress/rest-api";
import { saveServiceAccountKey, getServiceAccountStatus } from "../lib/google/service-account";
import { getVerticalsWithMarkets } from "../lib/queries/verticals";

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
  const vertical = arg("--vertical") ?? "";
  const ga4Property = arg("--ga4-property");
  const ga4Measurement = arg("--ga4-measurement");
  const wpApiBase = arg("--wp-api-base");
  const serviceAccountFile = arg("--service-account-file");
  const revalidateSecretFile = arg("--revalidate-secret-file");
  /**
   * WordPress username + Application Password, so a publisher arrives with
   * write access already working instead of someone opening wp-admin later.
   *
   * By FILE PATH, never as an argument. A password on a command line is in the
   * shell history, in `ps` output for every user on the box, and in any CI log
   * that echoes the command. The file can be created, read once, and deleted.
   *
   * Meant for the provisioning script that brings up a publisher's WordPress:
   * it already has container access, so it can mint the password with wp-cli
   * and hand the path over here. Nobody types it, and it never appears in a
   * chat window.
   */
  const wpUsername = arg("--wp-username");
  const wpAppPasswordFile = arg("--wp-app-password-file");

  if (!name || !url || !gsc || !ga4Property) {
    console.error("Thiếu tham số. Cần --name, --url, --vertical, --gsc, --ga4-property. Xem phần Usage ở đầu file.");
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

  /**
   * The derived WordPress URL is a GUESS, and this checks it.
   *
   * deriveWpApiBaseUrl builds `${url}/wp-json/wp/v2` from the public origin,
   * which is right for an ordinary WordPress install and wrong for every
   * headless one — where WordPress listens on loopback and the public origin
   * serves a Next.js app that has no /wp-json at all.
   *
   * It was wrong the first time this script ran in production, on a site whose
   * headless setup I had personally warned about hours earlier. The failure is
   * shaped to escape notice: the registration succeeds, every other field is
   * correct, and the broken value only surfaces later on a different screen as
   * "HTTP 404" in a column nobody was looking at.
   *
   * So the guess is tested before it is written. A warning, not an error: the
   * WordPress host can be down for reasons that have nothing to do with this
   * value, and refusing to register a site over a transient probe would be
   * worse than registering it with a note.
   */
  const effectiveWpApiBase = wpApiBase || deriveWpApiBaseUrl(url);
  const wpProbe = await probeWpApi(effectiveWpApiBase);
  if (!wpProbe.ok) {
    console.warn(`\nCẢNH BÁO: ${effectiveWpApiBase} không trả về 200 (${wpProbe.detail}).`);
    if (!wpApiBase) {
      console.warn(
        "  Giá trị này do script TỰ SUY RA từ URL công khai. Với site headless, WordPress thường chỉ nghe trên loopback\n" +
          "  của máy chủ và URL công khai không có /wp-json — khi đó phải truyền --wp-api-base, ví dụ\n" +
          "  --wp-api-base http://127.0.0.1:8090/wp-json/wp/v2"
      );
    }
    console.warn("  Website vẫn được đăng ký; cột \"Bài viết\" trong Publisher sẽ báo lỗi cho tới khi sửa giá trị này.\n");
  }

  // Keyed on gscPropertyUrl because that is the column carrying the unique
  // constraint. Upsert rather than create: re-running this after fixing a typo
  // should converge on the right row, not fail or duplicate.
  /**
   * Trade is required here for the same reason it is required in the UI: every
   * content rule keyed on trade vocabulary refuses to run for a trade it does
   * not know, so a missing or mistyped one produces a site whose content checks
   * silently do nothing.
   *
   * Checked against trades that actually have markets, not against a list typed
   * into this file — a list here would be the second definition of what a trade
   * is, and it would drift from the coverage data that is the first.
   */
  // Cả hai hoặc không cái nào. Một username không kèm mật khẩu tạo ra một
  // website trông như đã cấu hình mà mọi thao tác ghi đều 401 — và thông báo
  // lỗi lúc đó nói về xác thực, không nói về việc thiếu một nửa cấu hình.
  if (Boolean(wpUsername) !== Boolean(wpAppPasswordFile)) {
    console.error("\n--wp-username và --wp-app-password-file phải đi cùng nhau, hoặc bỏ cả hai.");
    process.exitCode = 1;
    return;
  }
  const wpAppPassword = wpAppPasswordFile
    ? readSecretFile(wpAppPasswordFile, "--wp-app-password-file").replace(/\s+/g, "")
    : null;

  const known = await getVerticalsWithMarkets();
  if (!known.includes(vertical)) {
    console.error(
      vertical
        ? `\nNgành "${vertical}" chưa có market nào. Đang có: ${known.join(", ")}`
        : `\nThiếu --vertical. Đang có: ${known.join(", ")}`
    );
    process.exitCode = 1;
    return;
  }

  const website = await prisma.website.upsert({
    where: { gscPropertyUrl: gsc },
    create: {
      name,
      url,
      vertical,
      ...(wpUsername && wpAppPassword ? { wpUsername, wpAppPassword } : {}),
      gscPropertyUrl: gsc,
      ga4PropertyId: ga4Property,
      ga4MeasurementId: ga4Measurement || null,
      wpApiBaseUrl: effectiveWpApiBase,
      ...(revalidateSecret ? { revalidateSecret } : {}),
    },
    update: {
      name,
      url,
      ga4PropertyId: ga4Property,
      ga4MeasurementId: ga4Measurement || null,
      wpApiBaseUrl: effectiveWpApiBase,
      // Only overwritten when a new one was supplied. Passing nothing must not
      // silently erase a secret that is already working.
      ...(revalidateSecret ? { revalidateSecret } : {}),
      ...(wpUsername && wpAppPassword ? { wpUsername, wpAppPassword } : {}),
    },
  });

  console.log(`\nĐã kết nối "${website.name}" (id ${website.id})`);
  console.log(`  url              ${website.url}`);
  console.log(`  gsc              ${website.gscPropertyUrl}`);
  console.log(`  ga4 property     ${website.ga4PropertyId}`);
  console.log(`  ga4 measurement  ${website.ga4MeasurementId ?? "(chưa đặt)"}`);
  console.log(`  revalidate secret ${website.revalidateSecret ? "đã đặt" : "(chưa đặt — site sẽ tự lấy khi cache hết hạn)"}`);
  console.log(`  wp api base      ${website.wpApiBaseUrl ?? "(mặc định)"}${wpApiBase ? "" : "  <- tự suy ra"}${wpProbe.ok ? "  [200 OK]" : "  [KHÔNG trả 200]"}`);
  console.log("\nKiểm lại từ bên ngoài: https://<host>/api/version — analyticsSource phải là \"hq\".");
}

/** One GET, short timeout. Only asks whether something answers 200 there. */
async function probeWpApi(base: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/posts?per_page=1&status=publish`, {
      signal: AbortSignal.timeout(10000),
    });
    return { ok: response.status === 200, detail: `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nTHẤT BẠI: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
