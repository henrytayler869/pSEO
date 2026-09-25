# Đưa `solieubongda.com` lên sóng — quy trình từng bước

Viết 25/9/2026. Trạng thái đo được lúc viết, không phải trạng thái giả định:

    whois Creation Date      2026-09-24T17:55:09Z   (đăng ký mới, không phải domain rụng)
    dig solieubongda.com     RỖNG — còn ở nameserver parking của Gname
    Website row              CÓ, vertical bong-da-nam, id cmuclgvm7…
    Domain row (HQ)          CHƯA CÓ  ← nút chặn đầu tiên
    revalidateSecret         NULL   (không còn chặn — xem "Trừ khi đẩy QUA")
    khoá API còn hiệu lực    1 (nhưng chỉ lưu keyHash — xem §3)
    deploy publisher         ĐỎ: 403 /sites/solieubongda.com/config
    hai site cũ              200, không noindex, KHÔNG gián đoạn

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

### Trừ khi đẩy QUA một site đang sống — thêm 25/9/2026

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

Hệ quả cho quy trình dưới đây: **bước 2 (nameserver) không còn là điều kiện
tiên quyết để deploy xanh.** Cấp khoá qua site anh em trước, deploy xanh, rồi
trỏ DNS khi thuận tiện. Các bước 1→6 vẫn phải chạy đủ để site có người xem.

## Thứ tự, và ai làm bước nào

Thứ tự này không đảo được. `provision.ts` đã mã hoá đúng nó, kèm lý do ở từng
bước — quy trình dưới đây chỉ là cách đọc nó cho một lần chạy cụ thể.

### Bước 1 — thêm Domain vào HQ  ·  *Control Panel*

`/domains` → thêm `solieubongda.com` → tạo zone Cloudflare. Bảng `Domain`
hiện chỉ có hai site cũ; **không có hàng `Domain` thì `provision` dừng ngay ở
bước "zone"** và không làm gì tiếp.

Bước này trả về **nameserver Cloudflare** — ghi lại, bước 2 cần.

### Bước 2 — trỏ nameserver tại Gname  ·  *CHỦ DỰ ÁN*

Đây là bước duy nhất không phần mềm nào làm được: đăng nhập Gname, đổi
nameserver của `solieubongda.com` sang cặp Cloudflare ở bước 1.

Kiểm trước khi đi tiếp — **đừng tin "đã bấm lưu"**:

```bash
dig +short NS solieubongda.com     # phải ra ns Cloudflare
```

Lan truyền có thể mất vài giờ. Bước 3 chạy sớm sẽ thất bại ở A record.

### Bước 3 — chạy provision  ·  *Control Panel*

`/publisher` → nút provision cho site này. Nó làm theo đúng thứ tự:

    1. A record, CHƯA proxy   proxy bật sớm thì thử thách ACME chết ở tầng edge,
                              với thông báo nói về challenge chứ không nói về SSL
    2. GA4 property + luồng web
    3. Nối Website vào HQ     (đã có — sẽ báo "skipped")
    4. Revalidate secret      CHÉP từ site đã có, không sinh mới
    5. Cấp + đẩy khoá         chỉ chạy khi 4 xong VÀ host trả lời được
    6. Bật proxy Cloudflare
    7. Ghi dữ liệu vào repo publisher

Bước 4 là chỗ gỡ `revalidateSecret = NULL` — không ai phải sinh hay cầm một
bí mật bằng tay.

### Bước 4 — nginx + chứng chỉ trên VPS  ·  *phiên VPS*

`provision` KHÔNG làm bước này — chú thích trong `provision.ts` nói thẳng:
*"Đẩy khoá cần host trả lời được → cần nginx + cert → là bước tay."*

Cần một server block cho `solieubongda.com` và một chứng chỉ. Kiểm:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://solieubongda.com/
```

Phải ra một mã HTTP thật, không phải lỗi TLS.

### Bước 5 — deploy lại publisher  ·  *phiên SEO bóng đá*

Kho khoá trên VPS là file `.hq-key` cạnh `.env.production`, và nó **sống qua
deploy** vì `deploy.sh` dùng `git reset --hard` chứ không `git clean`. Bước 3
mục 5 ghi đè nó dưới tên host mới.

```bash
npm run build          # 0 dòng HqError
npm run verify:rendered
```

### Bước 6 — đọc HTML thật  ·  *phiên SEO bóng đá*

Không phải bước hình thức. Hôm nay, ngay khi build chạy được lần đầu, việc
mở HTML ra đọc tìm thấy **250 trang có `{opponent}` rỗng** — HQ đổi chuỗi ghép
`"gặp"`→`"vs"`, phép tách bên publisher vẫn tìm `" gặp "`, và nó tồn tại ở
HAI file nên sửa một chỗ làm thân trang đúng mà **title vẫn sai**.

Mọi cổng đều xanh suốt thời gian đó.

## Ba chỗ đã cắn trong tuần này, đừng cắn lại

**`HQ_API_KEYS` là map THEO HOST.** Đổi host là đổi tên khoá trong map, ở cả
`.env.local` lẫn secret GitHub. Giá trị không đổi.

**Secret GitHub chỉ ảnh hưởng job `check` của CI, KHÔNG phải env runtime của
VPS.** Đổi secret xong mà deploy vẫn đỏ là đúng — hai thứ khác nhau.

**Cloudflare chặn User-Agent mặc định của Python/curl.** Một script kiểm khoá
quên `User-Agent` trả 403 cho cả ba site, và "403 cho tất cả" đọc y hệt "khoá
chết hết". Luôn đặt UA trình duyệt khi kiểm qua Cloudflare.

## Việc KHÔNG làm

- **Không sinh khoá khi chưa qua bước 4.** Khoá sinh ra mà không đẩy được là
  một hàng trong bảng không tương ứng với gì cả.
- **Không đặt `revalidateSecret` bằng tay.** Bước 3 mục 4 chép từ site đã có.
- **Không merge thêm gì vào `main` của publisher cho tới khi deploy xanh.**
  Mỗi PR mới đều chạy cùng một build và sẽ đỏ vì cùng một lý do, che mất lỗi
  thật của chính PR đó.
