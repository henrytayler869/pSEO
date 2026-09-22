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

## ĐỪNG ĐẶT BẤT BIẾN VÀO GIỮA HAI MARKER `nextjs-agent-rules`

Khối cuối file nằm giữa `<!-- BEGIN:nextjs-agent-rules -->` và
`<!-- END:nextjs-agent-rules -->` do `next dev` QUẢN LÝ, và quản lý theo kiểu
thay trọn: `upsertAgentRulesBlock` trong
`node_modules/next/dist/server/lib/generate-agent-files.js` ghép lại file bằng

    phần trước BEGIN  +  khối chuẩn mới  +  phần sau END

Mọi thứ NẰM GIỮA bị vứt. Không cảnh báo, không diff, không có gì đỏ.

Đã suýt mất thật. Đo 22/9/2026: mục `lib/football/` (viết trong #166) nằm
NGAY SAU marker BEGIN, và hai mục thêm vào sau đó rơi vào cùng vùng. Tổng
cộng 126 dòng — ba mục bất biến KHÔNG CÓ CỔNG CANH NÀO — sẽ biến mất ở lần
`npm run dev` kế tiếp, và chúng đúng là loại nội dung không thể dựng lại từ
mã vì chúng mô tả những thứ mã không nói ra.

Nên: mọi mục của con người đặt TRƯỚC marker BEGIN. Vùng giữa hai marker chỉ
được chứa đúng văn bản do Next sinh ra.

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

### HÀM QC VIẾT CHO TIẾNG ANH KHÔNG DÙNG ĐƯỢC CHO TIẾNG VIỆT

Site bóng đá viết tiếng Việt. Hai nguyên hàm dùng chung trong kho này chuẩn
hoá văn bản bằng biểu thức chỉ biết ASCII, và với tiếng Việt chúng KHÔNG hỏng
— chúng vẫn trả về một con số, chỉ là con số sai. Không có gì đỏ lên.

`longestSharedPhrase` (lib/article-qc/checklist.ts) lọc `[^a-z0-9\s]`, nên đo
22/9/2026:

    "Arsenal FC đang đứng thứ 2 trên bảng xếp hạng"
    -> arsenal|fc|ang|ng|th|2|tr|n|b|ng|x|p|h|ng

"bảng xếp hạng" thành sáu mẩu. Hai hệ quả ngược chiều nhau, nên không thể sửa
bằng cách chỉnh ngưỡng: ĐẾM PHỒNG gần gấp đôi (một cụm 5 từ đếm thành 8), và
ĐỤNG GIẢ vì mẩu `ng` gộp đứng/hạng/bảng/những thành một token. Cổng khác biệt
hoá vừa báo trùng lặp không có thật, vừa bỏ sót trùng lặp có thật.

`extractNumbers` (lib/ai/validate.ts) đọc "," là dấu phân nhóm nghìn, đúng với
tiếng Anh. Tiếng Việt dùng "," làm dấu THẬP PHÂN: "52,0%" ra 520, lệch mười
lần.

KHÔNG SỬA HAI HÀM ĐÓ. Chúng đang phục vụ hai site tiếng Anh với ngưỡng đã
hiệu chỉnh trên chính bộ chuẩn hoá ấy; đổi nó là đổi mọi ngưỡng cùng lúc.
Bản tiếng Việt nằm riêng:

    lib/ai/entity-distinctness.ts   normaliseVi, longestSharedPhraseVi
    lib/ai/entity-validate.ts       extractNumbersVi

Bất cứ phép kiểm văn bản nào thêm sau này cho site tiếng Việt phải đi qua hai
file đó, hoặc tự hỏi bộ chuẩn hoá của nó làm gì với dấu.

<!-- BEGIN:nextjs-agent-rules -->

## AGENTS.md: ĐỪNG viết gì vào giữa hai marker `nextjs-agent-rules`

Khối ở cuối file nằm giữa hai marker `BEGIN:nextjs-agent-rules` và
`END:nextjs-agent-rules` (chúng là comment HTML; ở đây cố tình KHÔNG viết đủ
dấu comment — xem đoạn cuối mục này). `next dev` GHI ĐÈ toàn bộ vùng đó. Đọc
`node_modules/next/dist/server/lib/generate-agent-files.js`, hàm
`upsertAgentRulesBlock`:

    const before = existing.slice(0, startIdx);
    const after  = existing.slice(endIdx + AGENT_RULES_END_MARKER.length);
    return before + normalizedBlock + after;

`trước BEGIN` + khối chuẩn MỚI + `sau END`. Mọi thứ người ta viết xen vào
giữa bị vứt — không cảnh báo, không lỗi, không gì đỏ lên.

Mục `lib/football/` phía trên ĐÃ nằm trong vùng đó từ 21/9/2026 tới
22/9/2026, chỉ vì tôi dán nó ngay trước tiêu đề của Next mà không để ý hai
dòng marker. Nó sống sót do may.

Và bẫy đóng lại ở câu cuối của chính khối kia: "committing it with your work
keeps the tree clean". Lời khuyên đó đúng cho khối Next và SAI cho mọi thứ
người ta lỡ đặt cạnh nó — nó dạy người ta commit một thay đổi họ không đọc.
Nếu vài chục dòng bất biến biến mất trong cùng diff đó, đúng câu ấy là thứ
khiến người ta bấm qua.

Viết mọi thứ của kho này TRƯỚC dòng BEGIN.

VÀ ĐỪNG TRÍCH NGUYÊN VĂN MARKER Ở BẤT CỨ ĐÂU TRONG FILE. Next tìm bằng
`existing.indexOf(...)` — tức lần xuất hiện ĐẦU TIÊN. Bản đầu của chính mục
này trích đủ cả `<!--` và `-->` để cho dễ đọc, và thế là marker giả ở đây trở
thành điểm bắt đầu, còn vùng bị ghi đè kéo dài từ đây xuống tận cuối file.
Phát hiện bằng cách chạy lại chính thuật toán của Next lên file mới: nó báo
mất 26 dòng ở chỗ lẽ ra không mất gì.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
