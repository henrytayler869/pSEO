"use server";

import { spawn } from "node:child_process";
import path from "node:path";
import { clearDevHealthCache } from "./health";

/**
 * Mở lại tunnel từ trong giao diện, để "vào localhost là chạy" không cần mở
 * terminal.
 *
 * Chạy đúng script trong repo, KHÔNG tự ghép lệnh ssh: host, cổng và khoá chỉ
 * được định nghĩa một chỗ, và một bản sao ở đây sẽ lệch vào lần đầu ai đó đổi
 * VPS.
 *
 * CHỈ Ở DEV. Trên VPS không có tunnel nào để mở, và một route sinh tiến trình
 * con trong production là một cánh cửa không ai cần.
 */
export async function repairTunnelsAction(): Promise<{ ok: boolean; message: string }> {
  if (process.env.NODE_ENV === "production") {
    return { ok: false, message: "Chỉ dùng được khi chạy dev trên máy cá nhân." };
  }

  const root = process.cwd();
  const results: string[] = [];

  for (const script of ["db-tunnel.sh", "wp-tunnel.sh"]) {
    const out = await run(path.join(root, "scripts", script), ["--ensure"]);
    results.push(`${script}: ${out.ok ? out.stdout.trim() || "xong" : out.stderr.trim() || `mã ${out.code}`}`);
  }

  clearDevHealthCache();
  return { ok: true, message: results.join(" · ") };
}

function run(cmd: string, args: string[]): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    // Hết giờ thì KẾT LUẬN là hỏng, không treo mãi: một nút bấm không phản hồi
    // còn khó hiểu hơn một nút báo lỗi.
    const timer = setTimeout(() => child.kill(), 30_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code ?? -1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: err.message });
    });
  });
}
