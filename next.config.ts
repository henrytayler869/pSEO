import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * The commit this build was made from, baked in at build time.
 *
 * Exists to answer one question without asking anyone: is the running server
 * serving the latest push, or something older? Until now that could only be
 * checked by having someone log into the machine and run `git rev-parse` —
 * which means the answer depended on a person being available, and on trusting
 * their report.
 *
 * Read from git rather than from an environment variable so it cannot be set
 * to something that isn't true. On the VPS the deploy has already run
 * `git reset --hard <sha>` before building, so this reads exactly the commit
 * CI verified.
 *
 * Falls back to "unknown" rather than failing the build: a container or a
 * tarball with no .git is a legitimate way to build, and a missing version
 * string is not worth refusing to ship over.
 */
function commitAtBuildTime(): string {
  if (process.env.PSEO_COMMIT) return process.env.PSEO_COMMIT;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  env: {
    PSEO_COMMIT: commitAtBuildTime(),
    PSEO_BUILT_AT: new Date().toISOString(),
  },
  turbopack: {
    /**
     * Gốc dự án, khai TƯỜNG MINH vì suy ra tự động cho kết quả sai trong git
     * worktree.
     *
     * Turbopack suy gốc bằng cách đi ngược tìm lockfile. Trong một worktree
     * dùng chung `node_modules` qua symlink, đường đi đó dẫn về KHO CHÍNH —
     * nơi thường đã có một `next dev` khác đang chạy. Next 16 khoá dev server
     * theo THƯ MỤC, nên nó coi worktree là cùng một dự án với kho chính, báo
     * "Another next dev server is already running" và thoát ngay.
     *
     * Đo 22/9/2026: `npm run predev` chạy sạch (exit 0), `.next/dev/logs/` được
     * tạo ra, log RỖNG, tiến trình biến mất trong vài giây và không cổng nào
     * lắng nghe. Không thông báo nào tới được terminal vì nó chết trước khi
     * kịp ghi log.
     *
     * `import.meta.dirname` chứ không phải chuỗi cứng: file này sống trong cả
     * kho chính lẫn mọi worktree, và một đường dẫn viết cứng sẽ đúng ở đúng
     * một nơi.
     */
    root: import.meta.dirname,
  },
};

export default nextConfig;
