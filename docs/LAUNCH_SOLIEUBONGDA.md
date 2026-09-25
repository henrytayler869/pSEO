# Đưa `solieubongda.com` lên sóng — quy trình từng bước

Viết 25/9/2026 sáng, **cập nhật cùng ngày chiều sau khi chạy thật bước 1→3**.
Trạng thái đo được lúc cập nhật, không phải trạng thái giả định:

    whois Creation Date      2026-09-24T17:55:09Z   (đăng ký mới, không phải domain rụng)
    dig NS solieubongda.com  jarred.ns.cloudflare.com, nina.ns.cloudflare.com   ✓
    zone Cloudflare          b85ea66ae82026a8b4f3370bb5aa3483  (status pending)
    A record apex + www      46.225.145.196  — CHƯA proxy, mây xám, có chủ ý
    Website row              ĐÚNG MỘT hàng, id cmuclgvm7…      (xem "Hàng trùng")
    GA4                      property 555962419, luồng G-6EQF6KSQV9
    gscPropertyUrl           sc-domain:solieubongda.com
    revalidateSecret         CÓ — chép từ theaccidentrecord.com ở bước 3
    khoá API còn sống        2, một trong đó ĐÃ nằm trên VPS
    build publisher          ✓ Compiled + 1395/1395 trang, 0 dòng HqError
    deploy publisher         ĐỎ — nhưng ở verify:live, KHÔNG còn ở 403
    hai site cũ              200, verify:live OK cả hai, KHÔNG gián đoạn

**Chỗ đỏ đã dời, và đó là thước đo tiến độ thật.** Sáng nay deploy chết ở
`403 /api/v1/sites/solieubongda.com/config` — tức build không có khoá. Giờ build
dựng trọn 1.395 trang; thứ đỏ là phép kiểm SAU deploy, vì `curl` không tới được
`https://solieubongda.com/`. Còn đúng một việc: bước 4.

## Điều đầu tiên phải hiểu, nếu không sẽ bấm nhầm nút

**Không có thao tác "đẩy lại khoá cũ".** `pushKeyToSite(site, key)` chỉ được
gọi từ trong `createPublisherKeyAction`, ngay sau khi **sinh khoá mới** — nó
cần giá trị khoá ở dạng rõ, mà bảng chỉ lưu `keyHash`. Bấm "tạo khoá" là sinh
khoá MỚI và đẩy nó; không có đường nào đẩy lại khoá đang có.

Và nó chỉ đẩy được khi **ba thứ đã sẵn**: host phân giải được, origin có
chứng chỉ cho host đó, và `revalidateSecret` đã có. Thiếu một thứ thì hàm trả
về sớm với lý do cụ thể — nó KHÔNG "hỏng nhưng báo ok", và chú thích trong
`push-key.ts` giải thích vì sao đó là thiết kế có chủ ý:

> *một khoá đẩy hụt mà báo thành công sẽ khiến người ta thu hồi khoá cũ và
> làm chết site.*

### Trừ khi đẩy QUA một site đang sống — thêm 25/9/2026, ĐÃ DÙNG THẬT

Ba điều kiện trên là của đường THẲNG. Ô chọn cạnh nút "Tạo khoá" mở đường thứ
hai: gửi yêu cầu tới host của một publisher **đang sống**, và đặt host đích
trong nội dung yêu cầu. Cả hai nút chặn của đường thẳng đều không còn nằm trên
đường này:

    nút chặn                        đẩy thẳng   đi qua site anh em
    DNS chưa phân giải              CHẶN        không đụng tới
    chưa có chứng chỉ               CHẶN        không đụng tới
    revalidateSecret của site NULL  CHẶN        dùng secret của site anh em

Nó tới đúng chỗ vì **một kho publisher phục vụ mọi site**: cùng build, cùng
tiến trình, cùng file `.hq-key`, và `writePushedKey` GỘP (`{...readMap(), [h]:
key}`) nên khoá của hai site kia không bị đụng. Endpoint bên publisher đã cố ý
nhận host lạ từ 17/9/2026 (`1ef64a9`, "gỡ vòng lặp dựng site mới") — trước bản
build đang chạy, nên đường này dùng được ngay mà không cần deploy lại trước.

Đánh đổi, nói thẳng: **secret của site B trở thành thứ cho phép ghi khoá của
site A.** Chấp nhận được vì ranh giới tin cậy ở đây là cả deployment chứ không
phải từng hostname, và ai cầm `REVALIDATE_SECRET` thì vốn đã purge sạch zone
Cloudflare cùng ép build lại được rồi.

**Phải chọn, không tự rơi vào.** Đẩy thẳng hụt thì báo hụt — không tự thử lại
qua host khác. Một đường vận chuyển bí mật tự đổi đích khi gặp lỗi là thứ không
ai truy được về sau.

Đã chạy thật lúc 08:07 ngày 25/9, trước khi DNS phân giải:

```bash
node_modules/.bin/tsx scripts/issue-publisher-key.ts \
  --site solieubongda.com --via <id site đang sống> "nhãn"
```

```
✓ Đã đẩy khoá cho solieubongda.com (đi qua atmovingservices.com)
  và site xác nhận ghi vào /srv/atmovingservices/.hq-key
```

Đường dẫn đó cũng là bằng chứng phụ cho tiền đề: **một** checkout
`/srv/atmovingservices` phục vụ cả ba host.

Hệ quả cho quy trình dưới đây: **bước 2 (nameserver) không phải điều kiện tiên
quyết để build xanh.** Cấp khoá qua site anh em trước là gỡ được nút khoá ngay.
Nhưng `verify:live` thì VẪN đòi host trả lời được, nên bước 2 và 4 vẫn phải xong
trước khi deploy hết đỏ.

## Thứ tự, và ai làm bước nào

Thứ tự này không đảo được. `provision.ts` đã mã hoá đúng nó, kèm lý do ở từng
bước — quy trình dưới đây chỉ là cách đọc nó cho một lần chạy cụ thể.

### ~~Bước 1 — thêm Domain vào HQ~~ · *XONG 25/9 08:2x, Control Panel*

Chạy bằng `scripts/add-domain.ts`, cùng đường mã với form ở `/domains`:

```bash
node_modules/.bin/tsx scripts/add-domain.ts --name solieubongda.com
```

    Đã TẠO zone mới     b85ea66ae82026a8b4f3370bb5aa3483
    status              pending
    nameservers         jarred.ns.cloudflare.com, nina.ns.cloudflare.com
    Publisher           đã nối: "Số Liệu Bóng Đá"

**`--vertical` cố ý BỎ TRỐNG.** Trường đó chỉ nhận niche đã có nghiên cứu
traffic, và cả 13 niche đang có đều là thị trường Mỹ; truyền `bong-da-nam` vào
sẽ bị từ chối. Liên kết Domain↔Publisher suy từ HOST nên vẫn nối đúng —
`relevantVertical` chỉ dùng cho luồng nghiên cứu domain bên Mỹ.

Lệnh này **nhận zone có sẵn thay vì tạo trùng**, nên chạy lại được.

### ~~Bước 2 — trỏ nameserver tại Gname~~ · *XONG 25/9, CHỦ DỰ ÁN*

Bước duy nhất không phần mềm nào làm được. Kiểm — **đừng tin "đã bấm lưu"**:

```bash
dig +short NS solieubongda.com
```

Đã ra `jarred.ns.cloudflare.com` + `nina.ns.cloudflare.com`. `dig +short A` còn
rỗng ở thời điểm đó, và đúng như vậy: A record là việc của bước 3.

### ~~Bước 3 — chạy provision~~ · *XONG 25/9 08:30, Control Panel — ĐỌC CẢ "Hàng trùng"*

`/publisher` → nút provision. Kết quả thật:

    [WAITING] Nghề "bong-da-nam" sẵn sàng   mỏng: chỉ số đặc tả cần verify:entity-spec
    [SKIPPED] Zone Cloudflare               đã có
    [DONE   ] A record                      apex + www → 46.225.145.196 (mới)
    [DONE   ] GA4                           property 555962419, luồng G-6EQF6KSQV9
    [SKIPPED] Nối Website                   ← NHÃN NÀY NÓI DỐI, xem dưới
    [DONE   ] Revalidate secret             chép từ theaccidentrecord.com
    [WAITING] Khoá API                      "đã thu hồi khoá vừa tạo" — xem dưới
    [WAITING] Đám mây cam                   chờ nginx + cert, bật sớm sẽ ra 526
    [WAITING] Ghi vào repo                  bong-da-nam chưa có đặc tả nội dung

Bước "Revalidate secret" là chỗ gỡ `NULL` — không ai phải sinh hay cầm một bí
mật bằng tay.

Bước "Khoá API" in nguyên văn:

    Chưa đẩy được (đã thu hồi khoá vừa tạo): Không gọi được
    https://solieubongda.com/api/hq-key: fetch failed

Site này **đã có hai khoá sống** và lẽ ra bước đó phải báo `skipped`. Nó không —
vì phép kiểm `findFirst({ where: { websiteId } })` hỏi về hàng `Website` MỚI vừa
bị tạo, và hàng đó chưa có khoá nào. Tức lỗi hàng trùng ở mục dưới còn kéo theo
một khoá sinh ra vô ích; may là đường thu hồi tự động đã dọn nó. Sau #187 bước
này báo `skipped` đúng.

#### Hàng trùng: provision đã TẠO hàng `Website` thứ hai cho cùng host

Đo 25/9/2026, và nó là lỗi mã chứ không phải lỗi thao tác. `provision.ts` nhận
diện site bằng

```ts
upsert({ where: { gscPropertyUrl: `sc-domain:${host}` } })
```

Hàng của site này có `gscPropertyUrl` **NULL** — Search Console gắn sau, và cột
đó nullable đúng vì thế — nên không khớp gì và `upsert` **tạo hàng mới**. Mọi
site dựng qua trang Publisher mà chưa gắn Search Console đều bị nhân đôi y vậy.

Hậu quả không tự lộ ra. Tài sản chia làm hai: khoá còn sống và sổ chi tiêu AI ở
hàng cũ; GA4 vừa tạo và secret vừa chép ở hàng mới. Thứ báo động đầu tiên là
`resolveSite` từ chối đoán, với thông báo nói về **"nhiều site"** chứ không nói
về hàng trùng.

Và **nhãn cũng nói dối**: `status: existing ? "skipped" : "done"` đọc biến
`existing` (tìm theo url — CÓ) trong khi `upsert` đi theo `gscPropertyUrl`
(KHÔNG có). Nên nó in `[SKIPPED] Nối Website: id <id mới>` **đúng lúc vừa tạo
một hàng**.

Đã sửa và merge: **[#187](https://github.com/henrytayler869/pSEO/pull/187)** —
cả `provision.ts` lẫn `scripts/connect-website.ts` (cùng một hình dạng) nay tìm
bằng `findWebsiteForDomain`, tức định nghĩa "cùng một site" của cả app.
**KHÔNG có cổng canh phần này**: tái hiện cần một database có hàng lệch, mà DB
của CI rỗng. `tsc` là tất cả những gì đang canh nó.

#### Nếu phải dọn hàng trùng: THỨ TỰ trong transaction

`gscPropertyUrl` là cột **unique**, và Postgres kiểm ngay trong transaction chứ
không hoãn tới lúc commit. Nên gán giá trị đó cho hàng gốc **trước khi** xoá
hàng trùng là P2002, dù cuối transaction chỉ còn một hàng giữ nó:

    gộp rồi xoá   → P2002 Unique constraint failed on (`gscPropertyUrl`)
    XOÁ rồi gộp   → chạy được

Transaction rollback trọn nên lần thất bại không để lại trạng thái nửa vời.
Kiểm bằng chính triệu chứng đã vỡ, không chỉ đếm hàng:

```bash
# phải trả về site, không phải lỗi "nhiều site"
node_modules/.bin/tsx -e "import {prisma} from './lib/db/prisma';import {resolveSite} from './lib/scripts/resolve-site';resolveSite({argv:['n','x','--site','solieubongda.com']}).then(console.log).finally(()=>prisma.\$disconnect())"
```

### Bước 4 — nginx + chứng chỉ trên VPS · *phiên VPS — VIỆC DUY NHẤT CÒN LẠI*

`provision` không làm bước này. Đã giao cho phiên VPS ngày 25/9.

**Hai chỗ trong kho này đang nói khác nhau, và tôi không đọc được VPS nên không
kết luận:**

- `manualSteps()` trong `lib/publisher/provision.ts` **không còn** liệt kê
  nginx/cert, kèm ghi chú *"18/9/2026 chiều — khối nginx CHUNG xoá bỏ mục thứ
  nhất"*.
- Mục này, ở bản viết buổi sáng, **vẫn** đòi "một server block cho
  `solieubongda.com` và một chứng chỉ", dẫn một chú thích cũ hơn.

Nếu khối nginx chung thật sự phục vụ mọi host thì có thể chỉ cần thêm host vào
chứng chỉ (`certbot --expand` hoặc cert riêng), không cần server block mới.
**Ai làm bước này: đọc cấu hình thật, làm theo cái đúng, rồi sửa chỗ sai trong
hai chỗ trên** — một tài liệu dạy làm thừa một bước cũng là một tài liệu sai.

Kiểm — phải ra **mã HTTP thật**, không phải lỗi TLS:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://solieubongda.com/
```

**ĐỪNG BẬT ĐÁM MÂY CAM Ở BƯỚC NÀY.** A record đang để mây xám có chủ ý: bật
proxy trước khi origin có chứng chỉ thì Cloudflare nối về bằng HTTPS tới một
origin không có cert → cả site trả **526**, và thử thách ACME chết **ở tầng
edge** với thông báo nói về challenge chứ không nói về SSL mode. Bật từ HQ sau.

### Bước 5 — bật proxy rồi deploy lại · *Control Panel, rồi phiên SEO bóng đá*

**Bật đám mây cam là việc TAY, provision không làm.** Đọc kỹ bước 6 của
`provision.ts`: khi origin chưa phục vụ HTTPS nó báo `waiting` kèm cảnh báo 526;
khi origin ĐÃ phục vụ, nó vẫn báo `waiting` — không lần nào nó gọi API để đặt
`proxied: true`. Nó chỉ chuyển sang `skipped · "Đã bật."` nếu đọc thấy record đã
proxy từ trước, tức do người bật.

Và câu nó in ra khi đó **dễ hiểu sai**: *"bấm lại sau khi xác nhận chứng chỉ
đúng host, hoặc bật tay"* — bấm lại KHÔNG bật gì thêm, chỉ in lại đúng dòng ấy.
Phần "bật tay" mới là đường thật. Lý do thiết kế thì đúng: thứ cần xác nhận là
chứng chỉ phủ **đúng host này**, không phải "có cái gì đó trả HTTPS" — và đó là
phán đoán của con người, không phải một mã trạng thái.

Nên: bật mây cam cho `solieubongda.com` và `www` trên dashboard Cloudflare (hoặc
qua API), sau khi đã xác nhận chứng chỉ ở origin phủ đúng host. Rồi cho deploy
chạy lại:

```bash
gh run list --repo henrytayler869/pseo-publisher --workflow=deploy.yml -L 3
gh run rerun <id lần đỏ>
```

Kho khoá trên VPS là file `.hq-key` cạnh `.env.production`, và nó **sống qua
deploy** vì `deploy.sh` dùng `git reset --hard` chứ không `git clean` — nên khoá
đã đẩy hôm nay không cần đẩy lại.

### Bước 6 — đọc HTML thật · *phiên SEO bóng đá*

Không phải bước hình thức. Hôm nay, ngay khi build chạy được lần đầu, việc
mở HTML ra đọc tìm thấy **250 trang có `{opponent}` rỗng** — HQ đổi chuỗi ghép
`"gặp"`→`"vs"`, phép tách bên publisher vẫn tìm `" gặp "`, và nó tồn tại ở
HAI file nên sửa một chỗ làm thân trang đúng mà **title vẫn sai**.

Mọi cổng đều xanh suốt thời gian đó.

## Năm chỗ đã cắn trong tuần này, đừng cắn lại

**`HQ_API_KEYS` là map THEO HOST.** Đổi host là đổi tên khoá trong map, ở cả
`.env.local` lẫn secret GitHub. Giá trị không đổi.

**Khoá sống ở BA nơi, không hai.** `.env.local`/`.hq-key` trên máy dev (build
tại chỗ), secret GitHub `HQ_API_KEYS` (**chỉ** job `check` của CI), và
`.env.production`/`.hq-key` **trên VPS** (build lúc deploy). Đổi secret GitHub
xong mà deploy vẫn đỏ là đúng — ba thứ khác nhau, và nơi thứ ba là nơi hay sai.

**Cloudflare chặn User-Agent mặc định của Python/curl.** Một script kiểm khoá
quên `User-Agent` trả 403 cho cả ba site, và "403 cho tất cả" đọc y hệt "khoá
chết hết". Luôn đặt UA trình duyệt khi kiểm qua Cloudflare.

**Nhận diện site theo HOST, không theo `gscPropertyUrl`.** Xem "Hàng trùng" ở
bước 3. Cột đó nullable, nên dùng nó làm khoá nhận diện là lặng lẽ tạo bản sao.

**Thêm cờ `--<tên> <giá trị>` vào script thì phải khai trong `VALUE_FLAGS`**
(`lib/scripts/argv.ts`). Quên thì giá trị của cờ lọt vào `positionals()` và
thành tham số vị trí — khoá cấp lúc 08:07 mang nhãn là ID của site trung
chuyển, không lỗi nào. Nay `scripts/test-argv.ts` quét và bắt được (#187).

## Việc KHÔNG làm

- **Không bật đám mây cam trước khi có chứng chỉ ở origin.** 526 cho cả site.
- **Không đặt `revalidateSecret` bằng tay.** Bước 3 chép từ site đã có.
- **Không sinh thêm khoá cho site này.** Đã có khoá sống và nó đã nằm trên VPS;
  provision sẽ tự báo "skipped". Sinh thêm chỉ tạo hàng không ai cầm.
- **Không merge thêm gì vào `main` của publisher cho tới khi deploy xanh.**
  Mỗi PR mới đều chạy cùng một build và sẽ đỏ vì cùng một lý do, che mất lỗi
  thật của chính PR đó. Và `verify:live` đỏ vì host chưa phân giải sẽ làm đỏ
  deploy của **mọi** phiên, kể cả thay đổi chẳng liên quan tới site bóng đá —
  đó là lý do bước 4 gấp hơn vẻ ngoài của nó.
