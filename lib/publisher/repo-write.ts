import { getCredential } from "@/lib/settings/credentials";

/**
 * Ghi dữ liệu của một publisher vào repo publisher, rồi mở PR.
 *
 * ═══ MỘT COMMIT CHO CẢ BỐN FILE, KHÔNG PHẢI BỐN LẦN GHI ═══
 *
 * API Contents ghi được một file mỗi lần gọi. Bốn lần gọi là bốn commit, và
 * một lần gãy ở giữa để lại nhánh có site.json nhưng chưa có markets.json —
 * tức một publisher tồn tại nhưng không có trang nào, đúng hình dạng hỏng câm
 * mà cả đợt này dọn.
 *
 * Nên dùng Git Data API: tạo blob cho từng file, gộp thành một tree, một
 * commit, một ref. Hoặc cả bốn file cùng vào, hoặc không gì vào.
 *
 * ═══ MỞ PR, KHÔNG ĐẨY THẲNG VÀO MAIN ═══
 *
 * CI của repo publisher chạy 11 cổng trước khi deploy. Đẩy thẳng vào main thì
 * chúng vẫn chạy, nhưng chạy SAU khi thay đổi đã là sự thật — và cách duy nhất
 * để lùi là một commit nữa. PR giữ nguyên thứ tự: cổng chạy, rồi mới hợp nhất.
 *
 * Người bấm "Dựng Site" không phải người đọc CI, nên PR cũng là chỗ báo cáo:
 * ai đọc nó thấy đúng bốn file đổi và thấy cổng nào xanh.
 */

const API = "https://api.github.com";

export class RepoWriteError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "RepoWriteError";
  }
}

async function gh(path: string, token: string, init?: { method: string; body?: unknown }): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "content-type": "application/json",
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      detail = (JSON.parse(text) as { message?: string }).message ?? detail;
    } catch {
      // giữ nguyên
    }
    throw new RepoWriteError(`GitHub trả ${res.status} cho ${path}: ${detail}`, res.status);
  }
  return text ? JSON.parse(text) : {};
}

export interface SiteFiles {
  host: string;
  /** Nội dung data/sites/<host>/site.json */
  site: unknown;
  /** data/sites/<host>/markets.json — null nếu chưa kéo được manifest. */
  manifest: unknown | null;
  /** data/sites/<host>/content-spec.json */
  spec: unknown;
}

/**
 * Sinh data/index.ts cho một danh sách host.
 *
 * Bản sao của scripts/build-data-index.ts bên repo publisher — hai nơi sinh
 * cùng một file, nên chúng PHẢI khớp. Cổng bên publisher
 * (scripts/verify-data-index.ts) đỏ khi chỉ mục lệch thư mục, nên một bản sao
 * trôi lệch sẽ bị bắt ở CI chứ không ship — đó là lý do chấp nhận bản sao ở
 * đây thay vì gọi qua mạng để sinh file.
 */
function renderIndex(hosts: string[]): string {
  const sorted = [...hosts].sort();
  const ident = (h: string, s: string) => `${h.replace(/[^a-zA-Z0-9]/g, "_")}_${s}`;
  const imports: string[] = [];
  const site: string[] = [];
  const man: string[] = [];
  const spec: string[] = [];
  for (const h of sorted) {
    imports.push(`import ${ident(h, "site")} from "./sites/${h}/site.json" with { type: "json" };`);
    imports.push(`import ${ident(h, "markets")} from "./sites/${h}/markets.json" with { type: "json" };`);
    imports.push(`import ${ident(h, "spec")} from "./sites/${h}/content-spec.json" with { type: "json" };`);
    site.push(`  ${JSON.stringify(h)}: ${ident(h, "site")},`);
    man.push(`  ${JSON.stringify(h)}: ${ident(h, "markets")},`);
    spec.push(`  ${JSON.stringify(h)}: ${ident(h, "spec")},`);
  }
  return `// SINH TỰ ĐỘNG bởi scripts/build-data-index.ts — ĐỪNG SỬA TAY.
//
// Chạy \`npm run data:index\` sau khi thêm hoặc bớt thư mục trong data/sites/.
// scripts/verify-data-index.ts đỏ khi file này lệch với thư mục thật.
//
// Tồn tại vì proxy.ts chạy ở biên: không đọc đĩa, không import động, nên danh
// sách publisher phải có mặt lúc biên dịch.

${imports.join("\n")}

export const SITE_INDEX = {
${site.join("\n")}
} as const;

export const MANIFEST_INDEX = {
${man.join("\n")}
} as const;

export const SPEC_INDEX = {
${spec.join("\n")}
} as const;

export const HOSTS = ${JSON.stringify(sorted)} as const;
`;
}

export interface WriteResult {
  ok: boolean;
  detail: string;
  prUrl?: string;
  branch?: string;
}

export async function writeSiteToRepo(files: SiteFiles): Promise<WriteResult> {
  const token = await getCredential("GITHUB_TOKEN");
  const repo = await getCredential("GITHUB_REPO");
  if (!token || !repo) {
    return { ok: false, detail: "Chưa đặt GITHUB_TOKEN và GITHUB_REPO ở trang Cài đặt." };
  }
  if (!files.manifest) {
    // Không ghi nửa vời: một publisher có site.json mà thiếu markets.json sẽ
    // dựng ra một site không trang nào, và cổng manifest-coverage bên publisher
    // sẽ đỏ — tốt hơn là không tạo PR đó ngay từ đầu.
    return { ok: false, detail: "Chưa có manifest cho host này. Chạy hq:markets trước — không ghi thiếu file." };
  }

  const host = files.host;
  const base = "main";

  try {
    // Host đã có trong repo, để dựng lại chỉ mục cho ĐỦ.
    const existing = (await gh(`/repos/${repo}/contents/data/sites?ref=${base}`, token)) as { name: string; type: string }[];
    const hosts = [...new Set([...existing.filter((e) => e.type === "dir").map((e) => e.name), host])];

    const ref = (await gh(`/repos/${repo}/git/ref/heads/${base}`, token)) as { object: { sha: string } };
    const baseSha = ref.object.sha;
    const baseCommit = (await gh(`/repos/${repo}/git/commits/${baseSha}`, token)) as { tree: { sha: string } };

    const payload: [string, string][] = [
      [`data/sites/${host}/site.json`, `${JSON.stringify(files.site, null, 2)}\n`],
      [`data/sites/${host}/markets.json`, `${JSON.stringify(files.manifest, null, 2)}\n`],
      [`data/sites/${host}/content-spec.json`, `${JSON.stringify(files.spec, null, 2)}\n`],
      ["data/index.ts", renderIndex(hosts)],
    ];

    const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
    for (const [p, content] of payload) {
      const blob = (await gh(`/repos/${repo}/git/blobs`, token, {
        method: "POST",
        body: { content, encoding: "utf-8" },
      })) as { sha: string };
      tree.push({ path: p, mode: "100644", type: "blob", sha: blob.sha });
    }

    const newTree = (await gh(`/repos/${repo}/git/trees`, token, {
      method: "POST",
      body: { base_tree: baseCommit.tree.sha, tree },
    })) as { sha: string };

    const commit = (await gh(`/repos/${repo}/git/commits`, token, {
      method: "POST",
      body: {
        message:
          `Dữ liệu publisher ${host}\n\n` +
          `Ghi bởi nút "Dựng Site" trong pSEO Control Panel.\n\n` +
          `  data/sites/${host}/site.json\n` +
          `  data/sites/${host}/markets.json\n` +
          `  data/sites/${host}/content-spec.json\n` +
          `  data/index.ts (${hosts.length} publisher)\n\n` +
          `Một commit cho cả bốn file: ghi từng file là bốn commit, và một lần\n` +
          `gãy ở giữa để lại publisher có danh tính mà không có trang nào.`,
        tree: newTree.sha,
        parents: [baseSha],
      },
    })) as { sha: string };

    // Nhánh mang tên host: hai publisher dựng gần nhau không đụng nhánh nhau.
    const branch = `publisher/${host.replace(/[^a-z0-9.-]/gi, "-")}`;
    try {
      await gh(`/repos/${repo}/git/refs`, token, {
        method: "POST",
        body: { ref: `refs/heads/${branch}`, sha: commit.sha },
      });
    } catch (e) {
      if (e instanceof RepoWriteError && e.status === 422) {
        // Nhánh đã có: đẩy tiếp lên nó thay vì gãy. Dựng lại một publisher là
        // việc bình thường — sửa tagline rồi bấm lại chẳng hạn.
        await gh(`/repos/${repo}/git/refs/heads/${branch}`, token, {
          method: "PATCH",
          body: { sha: commit.sha, force: true },
        });
      } else {
        throw e;
      }
    }

    /**
     * Từ đây trở đi, NHÁNH ĐÃ TỒN TẠI.
     *
     * Nên mọi lỗi sau điểm này không phải "không làm được gì" mà là "đã ghi
     * xong, chưa mở được PR" — hai câu dẫn tới hai hành động khác nhau, và gộp
     * chúng thành một thông báo lỗi buộc người bấm đoán xem repo đang ở đâu.
     *
     * Đo 18/9/2026: token có Contents nhưng thiếu Pull requests. Blob, tree,
     * commit, ref đều xong; chỉ bước cuối 403. Bản trước trả về một lỗi trần
     * và không nhắc gì tới nhánh vừa tạo.
     */
    const pushed = `Đã ghi 4 file lên nhánh ${branch}.`;

    let prs: { html_url: string }[] = [];
    try {
      prs = (await gh(`/repos/${repo}/pulls?head=${repo.split("/")[0]}:${branch}&state=open`, token)) as {
        html_url: string;
      }[];
    } catch (e) {
      const why = e instanceof RepoWriteError ? e.message : String(e);
      return {
        ok: false,
        branch,
        detail:
          `${pushed} NHƯNG không mở được PR: ${why}\n` +
          `Token cần thêm quyền "Pull requests: Read and write" — Contents là quyền RIÊNG, ` +
          `có Contents không có nghĩa là mở được PR. Mở PR bằng tay từ nhánh đó cũng được: ` +
          `dữ liệu đã nằm trên repo rồi.`,
      };
    }

    if (prs.length > 0) {
      return { ok: true, detail: `${pushed} PR đang mở.`, prUrl: prs[0].html_url, branch };
    }

    const pr = (await gh(`/repos/${repo}/pulls`, token, {
      method: "POST",
      body: {
        title: `Dữ liệu publisher ${host}`,
        head: branch,
        base,
        body:
          `Sinh bởi nút "Dựng Site" trong pSEO Control Panel.\n\n` +
          `Bốn file trong một commit. CI sẽ chạy toàn bộ cổng trước khi merge — ` +
          `trong đó \`verify:data-index\` kiểm chỉ mục khớp thư mục cả hai chiều, và ` +
          `\`verify:manifest-coverage\` đỏ nếu publisher này không dựng được trang nào.`,
      },
    })) as { html_url: string };

    return { ok: true, detail: `${pushed} Đã mở PR.`, prUrl: pr.html_url, branch };
  } catch (e) {
    const msg = e instanceof RepoWriteError ? e.message : e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg };
  }
}
