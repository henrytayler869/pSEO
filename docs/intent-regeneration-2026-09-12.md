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

## Đã sinh lại nốt 8 đoạn informational

8/8, 0 lỗi, **$0.1858**. Kiểm toán sau đó:

| Nhóm | n | giục so sánh | đánh giá |
|---|---|---|---|
| commercial | 97 | 23 (24%) | được phép |
| informational | 37 | **0 (0%)** | khớp |
| navigational | 16 | 0 (0%) | khớp |
| transactional | 11 | 0 (0%) | khớp |

`scripts/audit-intent-match.ts` thoát mã **0** — không còn đoạn nào giục so
sánh trong nhóm không được phép.

Ví dụ bản mới, ZIP 60634 Chicago (informational). Brief informational yêu cầu
nói cả thứ số liệu KHÔNG mô tả, và model làm đúng việc đó ba lần trong một
đoạn:

> …a picture of where new neighbors came from, **not of how many moving
> companies serve the area or what they charge**. … that is a Cook County
> total covering far more ground than this ZIP, so it **should not be read as
> a count of moves on any given street here**. … Median home value in the ZIP
> is $333,900 and median household income is $84,997 — **background on the
> area, not a guide to what a move costs**.

Không câu nào giục so sánh, không câu nào giục đặt dịch vụ.

## Còn lại## Còn lại## Còn lại

Không còn gì SAI để sửa. Kiểm toán về 0.

| Việc tuỳ chọn | Số đoạn | Chi phí |
|---|---|---|
| Cả nhóm `commercial` | 97 | ~$2.49 |
| 29 đoạn `informational` chưa lệch nhưng viết theo brief cũ | 29 | ~$0.75 |

`commercial` được phép giục so sánh nên nó không sai; sinh lại chỉ để brief
mới viết tốt hơn. 29 đoạn informational còn lại cũng vậy — chúng không chứa
câu giục so sánh nào nên phép đo không bắt được, nhưng chúng vẫn được viết
bởi một brief không biết người đọc đang làm gì.

Ngân sách còn **$0.7952** trên trần $7.00 — không đủ cho `commercial`.

Tổng chi cho toàn bộ việc sinh lại theo intent: **$0.6037** (27 + 8 + 1 đoạn
thử) trên 36 đoạn.

## Lệnh đo lại

```bash
# tỷ lệ giọng so sánh theo nhóm ý định
tsx scripts/audit-intent-match.ts
```
