# Bố cục máy này

Kho publisher nằm LỒNG TRONG kho này, có chủ ý:

    pseo-control-panel/              ← kho Head Quarter (henrytayler869/pSEO)
      publisher/
        atmovingservices/            ← kho publisher (henrytayler869/pseo-publisher)
        _archive/                    ← bản lưu mã nguồn của thứ đã xoá

`~/Documents/atmovingservices` KHÔNG còn tồn tại — nó đã chuyển vào đây ngày
19/9/2026. Một lệnh `cd` tới đường cũ thất bại lặng lẽ và các lệnh sau đó chạy
nhầm kho; đã xảy ra đúng như vậy trong ngày.

## Ba điều phải biết

1. `publisher/` được .gitignore che, và cũng bị loại khỏi `tsconfig.exclude`
   lẫn eslint ignores — BA nơi, vì ba công cụ đọc ba danh sách khác nhau.
   Không che thì `git add -A` nuốt 1,4 GB vào kho này dưới dạng embedded repo,
   `tsc` biên dịch cả cây đó, và `eslint .` trả 13.206 vấn đề không thuộc kho
   này.

2. `git clean -xdf` AN TOÀN — git bỏ qua kho lồng ("Would skip repository").
   `git clean -xdff` (HAI f) thì XOÁ SẠCH cả hai kho publisher. Đo 19/9/2026.

3. MỘT kho publisher phục vụ MỌI site. atmovingservices.com và
   theaccidentrecord.com chạy từ cùng `pseo-publisher`: một kho, một build,
   nhiều host, phân biệt theo Host header. Không có "kho riêng cho mỗi site",
   và một thư mục trông như thế là dấu hiệu có người đang nhầm.

   `publisher/theaccidentrecord` từng là một thư mục như vậy — scaffold riêng
   từ 15/9, không remote, không commit nào, 469 MB. Đã xoá 19/9 sau khi đối
   chiếu từng file: 23/24 file khác kho thật, và cả sáu file "chỉ có ở đó" đều
   là tên đời cũ của thứ đã được thay (`key.ts`→`key-store.ts`,
   `verify-routes.ts`→`verify-static-routes.ts`,
   `known-paths.json`→`data/sites/<host>/markets.json`). Không có gì độc bản.

   Mã nguồn (520 KB trong 469 MB) lưu ở
   `publisher/_archive/theaccidentrecord-scaffold-20260915.tar.gz`, 94 KB.
   Xoá được nếu không ai cần.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
