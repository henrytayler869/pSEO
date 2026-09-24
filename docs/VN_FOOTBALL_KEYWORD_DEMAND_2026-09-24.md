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
