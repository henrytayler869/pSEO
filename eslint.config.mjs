import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worktree của session khác. Không ignore thì `eslint .` tại chỗ soi luôn
    // code đang dở của người khác và trả về lỗi không phải của repo này — đo
    // 2026-09-10: 92 vấn đề, cả 92 đều từ đây. CI không thấy chúng (checkout
    // sạch, thư mục này untracked), nên cổng tại chỗ và cổng CI bất đồng, và
    // bất đồng theo chiều làm người ta ngừng tin cổng tại chỗ.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
