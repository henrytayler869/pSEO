# Bố cục máy này

Kho publisher nằm LỒNG TRONG kho này, có chủ ý:

    pseo-control-panel/              ← kho Head Quarter (henrytayler869/pSEO)
      publisher/
        atmovingservices/            ← kho publisher (henrytayler869/pseo-publisher)
        _archive/                    ← bản lưu mã nguồn của thứ đã xoá

`~/Documents/atmovingservices` KHÔNG còn tồn tại — nó đã chuyển vào đây ngày
19/9/2026. Một lệnh `cd` tới đường cũ thất bại lặng lẽ và các lệnh sau đó chạy
nhầm kho; đã xảy ra đúng như vậy trong ngày.

## `.claude/launch.json` khai HAI dev server, và cả hai tên là thật

    pseo-control-panel-dev   cổng 3000   kho này
    publisher                cổng 3002   kho publisher, qua --prefix vào thư mục lồng

Nó từng khai thêm hai mục `atmovingservices` và `theaccidentrecord`, cả hai
`--prefix` vào `~/Documents/<tên site>` — đường đã chết từ 19/9/2026. Chạy là
ENOENT ngay, và thông báo lỗi nói về `package.json` chứ không nói về đường dẫn
sai, nên nó đọc như "kho hỏng" chứ không như "cấu hình cũ".

Và một mục riêng cho mỗi site vốn đã sai: MỘT kho publisher phục vụ MỌI site
(xem mục 3). Dev server của nó chạy một lần ở cổng 3002, phân biệt site bằng
tiền tố đường dẫn — `/atmovingservices.com/...` hay `/theaccidentrecord.com/...`
— chứ không bằng hai tiến trình.

Vì sao vẫn giữ MỘT mục `publisher` ở đây thay vì bảo người ta sang kho kia.
`preview_start` đọc launch.json của THƯ MỤC GỐC phiên làm việc. Kho publisher
nằm LỒNG trong kho này, nên phiên nào gốc ở đây — phần lớn phiên — không có
đường nào gọi tới launch.json của kho publisher. Bỏ hẳn mục này không làm cấu
hình sạch hơn; nó làm dev server publisher trở thành thứ không khởi động được
từ chỗ người ta đang đứng. Đo 19/9/2026: `preview_start publisher` lên 3002 và
`/atmovingservices.com/moving-services/ny/brooklyn` trả HTTP 200.

Kho publisher có mục TRÙNG TÊN `publisher` trong launch.json của chính nó, và
đó là CỐ Ý. Cái bẫy trước đây không phải là trùng tên — nó là một tên HAI
NGHĨA: mục `atmovingservices` ở đây đã chết trong khi mục cùng tên bên kia còn
sống, nên gọi từ thư mục publisher vẫn trúng cái chết. Hai mục `publisher` bây
giờ khởi động cùng một app, cùng cổng 3002, từ cùng một thư mục. Một tên, một
nghĩa, gọi từ đâu cũng ra đúng thứ đó. Nếu sau này sửa một bên thì phải sửa cả
hai, nếu không cái bẫy cũ quay lại dưới tên mới.

KHÔNG CỔNG NÀO KIỂM ĐƯỢC RÀNG BUỘC ĐÓ. CI của kho publisher không thấy file
bên này (kho lồng, bị .gitignore che); CI của kho này không thấy file bên kia
(không commit vào đây). Đây là một bất biến chỉ sống bằng đúng đoạn văn bạn
đang đọc, trong một kho mà gần như mọi bất biến khác đều có cổng canh. Dựng
cổng cho nó không xứng chi phí — nhưng người sửa sau cần biết mình đang cầm
cái gì, vì ở đây không có gì đỏ lên khi làm sai.

Và bề mặt trôi rộng hơn cái tên: CỔNG 3002 cũng khai ở hai nơi, và đã khai hai
nơi từ trước khi có ai đổi tên. Cái tên không tạo ra ràng buộc; nó chỉ làm
ràng buộc dễ thấy hơn.

## `prisma generate` chạy trong `predev`, và vì sao nó phải ở đó

Client Prisma là mã SINH RA, nằm trong node_modules. `git pull` đem về một
schema mới nhưng KHÔNG sinh lại client, nên `prisma.<modelMới>` là `undefined`
và dòng ngay sau nó ném:

    Cannot read properties of undefined (reading 'findFirst')
      at getLastHostLeakCheck (lib/publisher/host-leak.ts:135)

Thông báo đó chỉ thẳng vào mã vừa viết và không nhắc gì tới client cũ — đo
20/9/2026, mất một vòng chẩn đoán để tới đúng nguyên nhân. Migration thì đã có
sẵn trong DB (dev nối vào DB production qua tunnel), nên không có dấu hiệu nào
khác.

1,5 giây mỗi lần `npm run dev`, đổi lấy việc không ai gặp lại thông báo đó.

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
