# Sinh lại nội dung theo ý định tìm kiếm — 12/9/2026

## Câu hỏi

194 trang publisher đã viết đúng ý định tìm kiếm chưa?

## Trả lời: chưa, và không thể đúng

`lib/ai/generate.ts` và `lib/ai/facts.ts` không nhắc `intent` lấy một lần, và
`FactSet` không có trường đó. 227 đoạn đã sinh được viết theo một brief duy
nhất.

Đo hệ quả trong chính văn bản — tỷ lệ đoạn mang ngôn ngữ so sánh báo giá:

| Nhóm ý định | n | "so sánh" | "đặt dịch vụ" |
|---|---|---|---|
| commercial | 142 | 94% | 25% |
| informational | 54 | 93% | 28% |
| navigational | 16 | 94% | 13% |
| transactional | 15 | **100%** | 27% |

Không biến thiên. Nhóm `commercial` đúng là do TÌNH CỜ — brief mặc định vốn là
giọng so sánh. Nhóm `transactional` lệch nặng nhất: người gõ `movers
pflugerville` để đặt xe nhận một trang bảo họ đi so sánh.

## Đã sinh lại

27 ZIP thuộc `transactional` + `navigational` mà publisher đang phục vụ.

| | |
|---|---|
| Sinh lại | 27/27, 0 lỗi |
| Chi phí | **$0.3922** |
| Giá mỗi đoạn | $0.0178 – $0.0302 |
| Ngân sách còn | $0.9809 / $7.00 |

Giá thực tế $0.0257/đoạn ở lần đo đầu cao hơn trung bình cả lô, vì nó là một
lần sinh đơn lẻ. Ước lượng $0.0177 từ trước đó cũng sai theo hướng khác: đó là
trung bình của 305 lần gọi lẫn cả những lần ngắn.

## Một phép đo của tôi đã ĐẾM LẪN, ghi lại vì nó dễ lặp

Phép đo đầu bắt cả chữ `quote`, nên báo 5/27 đoạn "vẫn còn giọng so sánh".
Đọc cả 5 thì không đoạn nào lệch — chúng dùng `quote` theo nghĩa *hỏi giá ở
hãng ĐÃ chọn*, và 4/5 nói thẳng "the company you have in mind" hoặc
"whichever firm you choose".

Hai nghĩa khác nhau hẳn:

- `compare quotes from two or three movers` — sai với transactional
- `when you call, say which of those your move is so the crew can quote the
  right travel time` — đúng

Đo lại bằng dấu hiệu tách được hai nghĩa:

| | |
|---|---|
| Giục đi so sánh nhiều hãng | **0/27** |
| Nói về một hãng đã chọn | 23/27 |

Bài học: một dấu hiệu bắt theo TỪ sẽ đếm lẫn hai ý nghĩa trái nhau, và con số
sai đó trông hợp lý đủ để tin. Dấu hiệu phải bắt theo CẤU TRÚC câu.

## Ví dụ trước/sau — ZIP 78660 (transactional)

Cũ:

> …worth mentioning when you call for quotes… **Get a written, itemized
> estimate from at least two movers**, and confirm what the price covers…
> before you book.

Mới:

> **Tell the company which of those your move is when you book**… confirm the
> crew's arrival window against your **closing and key-handover times**… Have
> an inventory of large or high-value items ready, and get the estimate, the
> valuation coverage and the payment terms in writing **before the truck is
> loaded**.

## Kiểm toán sau khi sinh lại

`scripts/audit-intent-match.ts` trên bản mới nhất của 161 ZIP:

| Nhóm | n | giục so sánh | đánh giá |
|---|---|---|---|
| commercial | 97 | 23 (24%) | được phép |
| informational | 37 | 8 (22%) | **LỆCH 8 đoạn** |
| navigational | 16 | 0 (0%) | khớp |
| transactional | 11 | 0 (0%) | khớp |

27 đoạn vừa sinh lại: **0 lệch**.

## Con số 93% của tôi đã SAI theo hướng phóng đại

Ở phần trên, bảng đo đầu tiên nói nhóm `informational` có 93% mang giọng so
sánh. Đo lại bằng dấu hiệu theo cấu trúc: **22%**, và chỉ **8 đoạn** thật sự
giục so sánh.

Cùng một lỗi với phép đo bắt chữ `quote`: dấu hiệu theo TỪ đếm lẫn, và lần này
nó phóng đại quy mô vấn đề gấp bốn lần. Hệ quả thực tế: chi phí sửa nhóm
`informational` không phải ~$0.95 cho 37 đoạn, mà **~$0.21 cho 8 đoạn**.

Một con số sai theo hướng phóng đại cũng tốn tiền — nó làm việc đáng làm trông
như việc phải xin thêm ngân sách.

## Còn lại## Còn lại

| Việc | Số đoạn | Chi phí |
|---|---|---|
| 8 đoạn `informational` đang lệch | 8 | **~$0.21** |
| Cả nhóm `informational` (kể cả đoạn đã khớp) | 37 | ~$0.95 |
| Cả nhóm `commercial` | 97 | ~$2.49 |

`commercial` được phép giục so sánh nên không có gì để sửa; nó chỉ đáng sinh
lại nếu muốn brief mới viết tốt hơn, không phải vì nó sai.

Ngân sách còn $0.9809 — đủ cho 8 đoạn lệch với đệm lớn.

## Lệnh đo lại

```bash
# tỷ lệ giọng so sánh theo nhóm ý định
tsx scripts/audit-intent-match.ts
```
