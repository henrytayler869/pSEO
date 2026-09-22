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

## `lib/football/` phải KHÔNG BIẾT GÌ về Next — và không có cổng nào canh

BỐN script chạy bằng `tsx` thuần, ngoài Next, và import thẳng vào tầng lib:

    verify-openfootball.ts     openfootball.ts, openfootball-txt.ts, season.ts
    verify-ucl-archive.ts      ucl-archive.ts, openfootball.ts
    verify-football-facts.ts   facts.ts, openfootball.ts, season.ts
    verify-page-axis.ts        lib/page-axis/axes.ts, openfootball.ts, season.ts

Thêm bất cứ thứ gì của Next vào SÁU file lib đó — `openfootball.ts`,
`openfootball-txt.ts`, `ucl-archive.ts`, `season.ts`, `facts.ts`,
`lib/page-axis/axes.ts` — là đánh sập những cổng tương ứng, và thông báo lỗi
khi ấy (`ERR_REQUIRE_ASYNC_MODULE`) không nhắc một chữ nào về caching, nên nó
đọc như "script hỏng" chứ không như "vừa thêm nhầm import".

`lib/page-axis/axes.ts` nằm ngoài `lib/football/` mà vẫn chịu cùng ràng buộc:
nó mô tả trục trang, không mô tả bóng đá, nên nó phải dùng được từ cả trang
lẫn script.

Chỗ duy nhất được phép biết Next là `lib/football/cached.ts`. Script không bao
giờ import file đó. Trang import nó, và chỉ nó.

KHÔNG CÓ CỔNG NÀO KIỂM RÀNG BUỘC NÀY. `tsc` không thấy gì sai, `eslint` không
thấy gì sai, `next build` càng không — cả ba đều chạy trong thế giới có Next.
Chỉ khi ai đó gõ `npm run verify:openfootball` mới vỡ, và đó là lệnh chạy tay
(xem đoạn dưới). Bất biến này sống bằng đúng đoạn văn bạn đang đọc.

Và hai cổng đó CỐ TÌNH không nằm trong CI: chúng đọc mạng, nên một lần GitHub
trục trặc sẽ làm đỏ PR của mọi session mà không nói gì về code — cùng lý lẽ
với khối "NOT run here" trong `.github/workflows/deploy.yml`. Chạy tay:

    npm run verify:openfootball     # 5 giải quốc nội, mùa đang đá
    npm run verify:ucl-archive      # 15 mùa Champions League đã kết thúc
    npm run verify:football-facts   # chỉ số cấp đội đối chiếu chéo buildStandings
    npm run verify:page-axis        # khoá trang + hàng EntityIdentity trong DB

## TẠM THỜI: database production ĐI TRƯỚC repo — đừng sinh migration từ nó

Có hiệu lực từ 22/9/2026 cho tới khi nhánh `vn-football-publisher` vào main.
Xoá mục này khi nó đã merge.

Migration `20260928000000_entity_page_axis` ĐÃ ÁP vào DB production — hai bảng
`EntityIdentity`, `AiEntityGeneration`, 977 hàng — nhưng nó CHƯA có trong
`prisma/migrations` của main, và `schema.prisma` của main chưa khai hai model
đó.

Hai chiều đọc, và chỉ một chiều an toàn. Đo 22/9/2026 trên shadow DB:

    migrate status                 "Database schema is up to date!"
    migrate deploy                 "No pending migrations to apply."  exit 0
    migrate diff --from-url <DB>   DROP TABLE "AiEntityGeneration";
                                   DROP TABLE "EntityIdentity";

Deploy KHÔNG gãy vì một migration đã áp mà thư mục không có. Nhưng bất kỳ ai
SINH migration từ DB thật — `prisma migrate dev`, hay `migrate diff --from-url`
trỏ production — sẽ nhận một migration XOÁ hai bảng cùng 977 hàng. Và nó sẽ
trông hoàn toàn hợp lệ trong diff của PR, vì với schema của main thì hai bảng
ấy ĐÚNG là thừa.

Nên: **không `prisma migrate dev`, không sinh migration từ production** cho
tới khi nhánh kia merge. Kiểm drift thì dùng

    npx prisma migrate diff --from-migrations prisma/migrations \
      --to-schema-datamodel prisma/schema.prisma \
      --shadow-database-url postgresql://postgres:shadow@127.0.0.1:55440/shadow

Chiều đó không đọc DB thật nên không thấy hai bảng. Shadow DB dựng bằng một
dòng và vứt đi được:

    docker run -d --name pseo-shadow -e POSTGRES_PASSWORD=shadow \
      -e POSTGRES_DB=shadow -p 55440:5432 postgres:16-alpine

Bài học chung, và nó đã nằm sẵn ở brief mục 6: một phép thử âm chỉ bác được
đúng thứ nó thử. "deploy chạy được" không phải "migration này an toàn".

ĐỌC NGUỒN QUA `fetchLeagueSeasonMerged`, KHÔNG PHẢI `fetchLeagueSeason`.
Bản JSON là NỀN; lớp phủ .txt mới là thứ mang kết quả mới nhất. Đo 22/9/2026,
cùng một ngày, cùng một giải:

    fetchLeagueSeason        Ngoại hạng Anh  40/380 trận, trễ 8 ngày
    fetchLeagueSeasonMerged  Ngoại hạng Anh  50/380 trận, trễ 2 ngày

Mười trận và sáu ngày. Không có gì đỏ lên khi dùng nhầm hàm — trang vẫn dựng
đủ, bảng xếp hạng vẫn cộng đúng, chỉ là của tuần trước. Ligue 1 không có lớp
phủ nên hai hàm cho cùng kết quả, và đó chính là lý do nó trễ 9 ngày.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
