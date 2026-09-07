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

import { setAdminPassword, getAdminPasswordHash } from "../lib/auth/password";
import { prisma } from "../lib/db/prisma";

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
  await setAdminPassword(password);

  console.log(had ? "Đã ĐỔI mật khẩu quản trị." : "Đã ĐẶT mật khẩu quản trị lần đầu.");
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
