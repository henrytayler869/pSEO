# Bố cục máy này

Kho publisher nằm LỒNG TRONG kho này, có chủ ý:

    pseo-control-panel/              ← kho Head Quarter (henrytayler869/pSEO)
      publisher/
        atmovingservices/            ← kho publisher (henrytayler869/pseo-publisher)
        theaccidentrecord/           ← scaffold cũ, KHÔNG phục vụ site nào

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

3. **`publisher/theaccidentrecord` không phục vụ site nào.** Nó là một
   scaffold riêng từ 15/9: không remote, KHÔNG COMMIT NÀO, 24 file đang chờ,
   469 MB. Site theaccidentrecord.com thật chạy từ `pseo-publisher` cùng với
   atmovingservices.com — một kho, một build, nhiều host, phân biệt theo Host
   header.

   Nó cũng đã lệch hẳn: không có `nodeId`, `wpBaseFor`, `labelNumbersOf`,
   `chooseSite` — tức thiếu toàn bộ phần đa-site và các bản vá validator của
   ngày 19/9. Sửa trong đó thì không có gì lên site.

   Chưa xoá vì nó là 469 MB có 24 thay đổi chưa commit và không có bản sao ở
   đâu khác. Cần người quyết định.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
