# Cầu tìm kiếm tiếng Việt cho site bóng đá — đo 24/9/2026

Nguồn: DataForSEO Labs `related_keywords/live`, `location_code 2704`,
`language_code vi`. Sáu mồi, chi phí **$0,077**. Số là lượt tìm/tháng.

## Câu hỏi đang mở, và câu trả lời

**876/977 trang của site nằm trên trục "đối đầu" — người Việt có tìm kiểu đó
không?**

Có, nhưng **nhỏ hơn hai bậc** so với các nhánh khác. Và trục đang được đặt tên
sai.

## Sáu mồi, kết quả

| mồi | số từ khoá có volume | cao nhất |
| --- | --- | --- |
| `kết quả bóng đá` | 6 | 49.500 |
| `bảng xếp hạng ngoại hạng anh` | 8 | **550.000** |
| `đối đầu mu vs liverpool` | **0** | — |
| `mu vs liverpool` | 8 | 1.300 |
| `nhận định mu vs liverpool` | 7 | **673.000** |
| `lịch thi đấu bóng đá` | 8 | 165.000 |

## Bốn điều rút ra, theo thứ tự quan trọng

### 1. "đối đầu" KHÔNG phải từ người Việt dùng

    "đối đầu mu vs liverpool"   ->  0 từ khoá có volume
    "mu vs liverpool"           ->  8 từ khoá, cao nhất 1.300

Cùng một ý, hai cách gọi, một bên rỗng. Trang của trục này đang mang nhãn
"đối đầu" trong `entity-spec`. Từ người dùng gõ là **`vs`**.

Lần đo đầu tôi chỉ chạy mồi `"đối đầu mu vs liverpool"`, được 0, và suýt kết
luận "trục này không có cầu". Mồi thứ hai bác bỏ điều đó. **Một mồi trả về 0
là dữ liệu về MỒI, không phải về chủ đề.**

### 2. Thứ tự tên đội đổi lưu lượng gấp 31 lần

    liverpool vs mu   40.500
    mu vs liverpool    1.300

Cùng hai đội. Trang cặp phải chọn thứ tự theo cầu, không theo bảng chữ cái
hay theo chủ/khách. Hiện `entities.json` khoá cặp theo thứ tự nào thì cần
kiểm lại.

### 3. Ba nhánh có cầu LỚN, và site đang phục vụ đúng một

    nhận định bóng đá              673.000   ← soi kèo/dự đoán TRƯỚC trận
    lịch thi đấu ngoại hạng anh    550.000   ← lịch, đã HOÃN tích hợp
    lịch thi đấu bóng đá việt nam  165.000   ← lịch, và là V.League: KHÔNG có nguồn
    bảng xếp hạng la liga          135.000   ← site CÓ (trang giải)
    bảng xếp hạng serie a / ý       49.500
    kết quả bóng đá hôm nay        49.500   ← site CÓ, trễ 2 ngày

`nhận định` là nhánh lớn nhất và nó là **dự đoán TRƯỚC trận**. Chủ dự án đã
chốt làm **bài SAU trận**. Hai thứ khác nhau, và cầu nằm ở phía kia.

`lịch thi đấu` là nhánh lớn thứ hai và đã bị hoãn tích hợp — trong khi dữ
liệu lịch thì **đã có sẵn** trong file mùa giải (trận chưa đá có
`fullTime: null`).

### 4. Trục cặp là cái đuôi dài, không phải thân

Cặp lớn nhất của giải Anh — hai CLB đối địch nổi tiếng nhất — đạt 1.300 và
40.500 tuỳ thứ tự. 876 cặp còn lại phần lớn thấp hơn nhiều. Đó là một cái
đuôi dài hợp lệ, nhưng nó **không phải chỗ đặt 90% số trang** nếu mục tiêu là
lưu lượng.

## Việc phép đo này KHÔNG chứng minh

- Sáu mồi không phải toàn bộ không gian truy vấn. Nhánh nào chưa hỏi thì
  chưa biết.
- `related_keywords` trả về *lân cận ngữ nghĩa của mồi*, không phải bảng xếp
  hạng cầu của cả chủ đề. Số lớn ở đây nói "nhánh này có cầu", không nói
  "đây là từ khoá nên nhắm".
- Chưa đo độ khó (KD) hay SERP. Một từ khoá 673.000 lượt có thể do báo lớn
  chiếm hết.

## Chạy lại

    npm run verify:keyword-markets     # cổng canh, không tốn tiền
    # mồi khai ở lib/keywords/markets.ts

Mỗi task DataForSEO khoảng **$0,013**. Sáu mồi là $0,077.

## Đợt đo thứ hai: TÊN ĐỘI (thêm $0,050 — tổng $0,127)

`displayName` hiện là tên openfootball — "Manchester United FC",
"FC Bayern München", "1. FC Köln". Người Việt gõ gì?

| mồi | số từ khoá | cao nhất |
| --- | --- | --- |
| `manchester united` | 8 | **135.000** `lịch thi đấu mu` |
| `bayern munich` | 8 | 12.100 `bayern munich vs real` |
| `1. fc köln` | **0** | — |
| `tottenham hotspur` | **0** | — |

### 5. Tên chính thức KHÔNG phải tên người Việt gõ

    lịch thi đấu mu      135.000
    chuyển nhượng mu      22.200

Họ gõ **"mu"**. Trang đội đang mang tiêu đề "Manchester United FC".

Hai mồi trả **0**: `1. FC Köln` và `Tottenham Hotspur`. Köln là CLB nhỏ ở thị
trường này nên 0 còn hiểu được; **Tottenham thì không** — đó là CLB lớn, và 0
ở đây nghĩa là *cái tên đầy đủ* không có cầu, không phải *đội* không có cầu.
96 trang đội đang đặt tên theo cách không ai tìm.

### 6. Mọi nhánh đều dẫn về LỊCH THI ĐẤU

Sáu mồi, ba đợt, nhánh lớn nhất luôn là lịch:

    lịch thi đấu ngoại hạng anh    550.000
    lịch thi đấu bóng đá việt nam  165.000
    lịch thi đấu mu                135.000
    lịch thi đấu bóng đá wc 2026   135.000

Đây là thứ đã bị **hoãn tích hợp**, trong khi dữ liệu lịch **đã có sẵn** —
trận chưa đá nằm ngay trong file mùa giải với `fullTime: null`.

## Tổng kết cho người quyết

Bốn quyết định lớn của site, đặt cạnh số đo:

| quyết định | cầu đo được |
| --- | --- |
| bài SAU trận, không dự đoán trước | `nhận định bóng đá` 673.000 — nhưng xem §7, đây KHÔNG phải cơ hội bỏ lỡ |
| hoãn lịch thi đấu | nhánh lớn nhất ở MỌI đợt đo |
| 876/977 trang là cặp đối đầu | cặp lớn nhất 1.300–40.500, phần lớn thấp hơn |
| tên đội theo openfootball | `mu` 135.000; `Tottenham Hotspur` **0** |

Đây là SỐ, không phải khuyến nghị. Quyết định thuộc về chủ dự án.

## 7. SỬA MỘT KHUNG SAI TRONG CHÍNH TÀI LIỆU NÀY

Bảng trên, bản đầu, đặt `nhận định bóng đá 673.000` cạnh quyết định "bài SAU
trận" và nó **đọc như một khoản bỏ lỡ**. Phiên SEO bóng đá bác lại, và đúng:

`nhận định` ở thị trường này phần lớn là **soi kèo** — nội dung cá cược.
Validator của site cấm từ vựng đó; doanh thu là banner và mạng quảng cáo soi
kỹ nội dung cờ bạc; bàn giao 23/9 §3 đã cấm cả việc đặt tên miền gợi cá cược
vì đúng lý do ấy.

Nên quyết định "bài sau trận" đang **BẢO VỆ mô hình doanh thu**, không phải
bỏ lỡ cầu. Một con số lớn cạnh một quyết định không tự động là lời trách —
và tôi đã bày nó theo cách đọc ra như thế.

Với `lịch thi đấu` thì kết luận giữ nguyên, và phiên kia thêm một lý lẽ chưa
ai nêu: **độ trễ 2–9 ngày không làm hỏng trang lịch**, vì lịch trận sắp đá
công bố trước hàng tuần. Độ trễ chỉ cắn nội dung SAU trận. Ligue 1 trễ 9 ngày
vẫn ra lịch vòng tới bình thường — nhánh lớn nhất lại là nhánh mà điểm yếu dữ
liệu đã biết không chạm tới.

## 8. TÊN ĐỘI, đo bằng endpoint ĐÚNG (search_volume + KD)

`related_keywords` sai công cụ cho câu này: nó cần một MỒI, và mồi
`"tottenham hotspur"` trả 0 — hỏi bằng cái tên không ai gõ thì câu trả lời
rỗng, rồi rỗng đọc nhầm thành "đội này không ai tìm". So các biến thể tên
thì phải hỏi TỪNG biến thể: `keywords_data/google_ads/search_volume`.

Thị trường Việt Nam, 2704/vi:

| chuỗi | lượt/tháng | KD |
| --- | --- | --- |
| **mu** | **1.000.000** | **26** |
| manchester united | 450.000 | 51 |
| man utd | 450.000 | 38 |
| tottenham | 135.000 | 74 |
| bayern | 110.000 | 39 |
| bayern munich | 74.000 | 39 |
| **manchester united fc** | **5.400** | 71 |
| tottenham hotspur | 1.900 | — |
| `1. fc köln` · `fc koln` · `koln` | **không có dữ liệu** | |

`mu` so với `manchester united fc`: **gấp 185 lần lượt tìm, ở một phần ba độ
khó** (KD 26 so với 71). `displayName` của openfootball đang là lựa chọn tệ
nhất trong các biến thể.

`tottenham` 135.000 so với `tottenham hotspur` 1.900 — gấp 71 lần.

### Và một đối chứng ngoài ý muốn

Lần chạy đầu của phép đo này **trượt về thị trường Mỹ** — phép thay chuỗi
không khớp thụt lề nên `location_code` vẫn là 2840, và `eslint` đã cảnh báo
`'market' is assigned a value but never used`. Tôi chạy probe trước khi đọc
kỹ cảnh báo đó.

Kết quả sai ấy hoá ra hữu ích:

    spurs   ở Mỹ      5.000.000        ← đội bóng rổ San Antonio Spurs
    spurs   ở Việt Nam  không có dữ liệu

Cùng một chuỗi, hai thị trường, hai câu trả lời không liên quan gì nhau. Đo
nhầm thị trường không cho ra lỗi — nó cho ra một bảng số trông hoàn toàn hợp
lý.
