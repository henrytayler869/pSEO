// Sets the single admin password for the Control Panel UI.
//
// Reads the password from STDIN, never from an argument. An argument would
// land in shell history, in the process list where any other user on the box
// can read it with ps, and in the systemd journal if run from a unit. Stdin
// avoids all three.
//
// Usage (does not echo, does not store in history):
//   read -rs PW && printf '%s' "$PW" | npx tsx scripts/set-admin-password.ts && unset PW
//
// Only a scrypt hash is written. The plaintext exists in this process for as
// long as it takes to hash it and nowhere else — not in the repository, not in
// .env, not in the database.

import os from "node:os";
import { setAdminPassword, getAdminPasswordHash, verifyPassword } from "../lib/auth/password";
import { prisma } from "../lib/db/prisma";

/** Where this just wrote, in terms a person can check against where they meant
 * to write.
 *
 * Added after a real incident: the command was run and succeeded, the hash
 * landed in AppConfig exactly as expected — on the wrong machine. It went to
 * the developer's laptop instead of the server, because the instructions were
 * split into two shell blocks and the second one ran fine locally, the repo
 * being present there too.
 *
 * Nothing about that failure looked like a failure. The script reported
 * success, the row appeared, and the only signal left was a login attempt that
 * would not work days later.
 *
 * The database host does NOT distinguish the two: both are 127.0.0.1:5433. The
 * machine's hostname does, so that is what gets printed. */
function whereDidThisGo(): string {
  const url = process.env.DATABASE_URL ?? "";
  let target = "(không đọc được DATABASE_URL)";
  try {
    const u = new URL(url);
    // Host, port and database name only — never the credentials in the URL.
    target = `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    /* leave the fallback */
  }
  return `${os.hostname()} -> ${target}`;
}

const MIN_LENGTH = 8;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  // Trailing newline is what a terminal adds when you press enter, not part of
  // the password. Stripped here rather than left to surprise someone whose
  // password silently ends in \n and cannot be typed into a form.
  return Buffer.concat(chunks).toString("utf-8").replace(/\r?\n$/, "");
}

async function main() {
  if (process.stdin.isTTY) {
    console.error("Mật khẩu phải đưa qua stdin, không phải tham số dòng lệnh.");
    console.error(`  read -rs PW && printf '%s' "$PW" | npx tsx ${process.argv[1]} && unset PW`);
    process.exitCode = 1;
    return;
  }

  const password = await readStdin();
  if (password.length < MIN_LENGTH) {
    console.error(`Mật khẩu quá ngắn (tối thiểu ${MIN_LENGTH} ký tự).`);
    process.exitCode = 1;
    return;
  }

  const had = await getAdminPasswordHash();

  // Refuse a "new" password that is the one already stored.
  //
  // The Settings form already refuses this, by comparing the two plaintexts it
  // has. This path never sees the old plaintext — but it does not need to:
  // verifying the NEW password against the STORED hash answers the same
  // question.
  //
  // It matters because of what an observer can and cannot tell. Writing this
  // row changes updatedAt and produces a different hash either way, since the
  // salt is regenerated every time. So an unchanged password and a real change
  // look identical from outside — which is exactly the situation someone lands
  // in after rotating a password they believe was exposed. Without this check,
  // "I changed it" and "the record was rewritten" are two different facts that
  // no measurement can separate.
  if (had && verifyPassword(password, had)) {
    console.error("Mật khẩu mới TRÙNG mật khẩu hiện tại — không ghi gì.");
    console.error("Ghi lại vẫn đổi hash (salt sinh mới mỗi lần) và vẫn đổi updatedAt, nên nhìn từ");
    console.error("bên ngoài sẽ giống hệt một lần đổi thật. Nếu bạn đang xoay mật khẩu vì nghi lộ,");
    console.error("thì đây đúng là trường hợp không được để lọt.");
    process.exitCode = 1;
    return;
  }

  await setAdminPassword(password);

  console.log(had ? "Đã ĐỔI mật khẩu quản trị." : "Đã ĐẶT mật khẩu quản trị lần đầu.");
  console.log(`Ghi vào: ${whereDidThisGo()}`);
  console.log("^ KIỂM DÒNG TRÊN. Nếu đó không phải máy chủ production thì bạn vừa đặt mật khẩu cho máy khác.");
  console.log("Mọi phiên đang đăng nhập vẫn còn hiệu lực tới khi hết hạn (12 giờ) —");
  console.log("phiên ký bằng SESSION_SECRET, không bằng mật khẩu. Cần đá hết mọi phiên");
  console.log("ngay lập tức thì đổi SESSION_SECRET rồi restart service.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
