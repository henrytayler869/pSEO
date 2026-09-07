// Proves the password-change rules, especially the one that matters.
//
// The security-critical branch is "current password required and must verify".
// Being logged in is evidence that someone authenticated at some point, not
// that the person at the keyboard is the owner — an unattended browser, a
// stolen cookie and a borrowed laptop all carry a valid session. If that branch
// ever inverted, a session would silently become permanent ownership of the
// account, and nothing about the UI would look different.
//
// Usage: tsx scripts/test-password-change.ts

import { decidePasswordChange } from "../lib/auth/change-password";
import { hashPassword } from "../lib/auth/password";

const hash = hashPassword("mat-khau-hien-tai");

const CASES: { name: string; input: Parameters<typeof decidePasswordChange>[0]; expectOk: boolean }[] = [
  {
    name: "BẢO MẬT: đổi mà KHÔNG nhập mật khẩu cũ -> chặn",
    input: { existingHash: hash, current: "", next: "matkhaumoi1", confirm: "matkhaumoi1" },
    expectOk: false,
  },
  {
    name: "BẢO MẬT: mật khẩu cũ sai -> chặn",
    input: { existingHash: hash, current: "sai-be-bét", next: "matkhaumoi1", confirm: "matkhaumoi1" },
    expectOk: false,
  },
  {
    name: "mật khẩu cũ đúng -> cho qua",
    input: { existingHash: hash, current: "mat-khau-hien-tai", next: "matkhaumoi1", confirm: "matkhaumoi1" },
    expectOk: true,
  },
  {
    name: "hai ô mới không khớp -> chặn",
    input: { existingHash: hash, current: "mat-khau-hien-tai", next: "matkhaumoi1", confirm: "matkhaumoi2" },
    expectOk: false,
  },
  {
    name: "mật khẩu mới quá ngắn -> chặn",
    input: { existingHash: hash, current: "mat-khau-hien-tai", next: "ngan", confirm: "ngan" },
    expectOk: false,
  },
  {
    name: "mới trùng cũ -> chặn",
    input: { existingHash: hash, current: "mat-khau-hien-tai", next: "mat-khau-hien-tai", confirm: "mat-khau-hien-tai" },
    expectOk: false,
  },
  {
    name: "chưa có mật khẩu -> đặt lần đầu, không đòi mật khẩu cũ",
    input: { existingHash: null, current: "", next: "matkhaudau1", confirm: "matkhaudau1" },
    expectOk: true,
  },
  {
    name: "chưa có mật khẩu nhưng quá ngắn -> vẫn chặn",
    input: { existingHash: null, current: "", next: "abc", confirm: "abc" },
    expectOk: false,
  },
];

function main() {
  let passed = 0;
  for (const c of CASES) {
    const d = decidePasswordChange(c.input);
    const ok = d.ok === c.expectOk;
    if (ok) passed++;
    console.log(`${ok ? "✓" : "✗"} ${c.name}${d.ok ? "" : `  [${d.reason}]`}`);
  }

  // Separate assertion: a wrong current password must be marked slow. Without
  // the delay, this endpoint is a fast oracle for guessing the current password
  // from inside a session that already has one — the answer is correct either
  // way, so only this check can catch its absence.
  const wrong = decidePasswordChange({
    existingHash: hash,
    current: "sai",
    next: "matkhaumoi1",
    confirm: "matkhaumoi1",
  });
  const slowOk = !wrong.ok && wrong.slow === true;
  if (slowOk) passed++;
  console.log(`${slowOk ? "✓" : "✗"} ca "mật khẩu cũ sai" được đánh dấu CHẬM (chống dò từ trong phiên)`);

  const total = CASES.length + 1;
  console.log(`\n${passed}/${total} đúng.`);
  if (passed !== total) process.exitCode = 1;
}

main();
