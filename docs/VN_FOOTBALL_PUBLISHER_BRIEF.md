# Publisher thị trường Việt Nam — bàn giao

Viết 22/9/2026 cho một session riêng sẽ dựng publisher bóng đá Việt Nam.
Mọi con số dưới đây là **đo được**, không phải ước lượng; ngày đo ghi kèm khi
nó quan trọng.

---

## 1. Quyết định của chủ dự án

- Thị trường Việt Nam **chỉ một niche**: bóng đá nam. Không chấm điểm niche.
- Mục tiêu kiếm tiền: **treo banner quảng cáo**. Chưa có con số RPM nào — đây
  vẫn là ẩn số lớn nhất về phía doanh thu.
- Loại nội dung muốn dựng:
  1. **Số liệu bóng đá nói chung** — phong độ, số liệu phân tích.
  2. **Nhận định kết quả trận đấu**, chấp nhận **trễ 1 ngày** sau khi trận kết
     thúc.
- **Chưa tích hợp lịch thi đấu.** Đây là ràng buộc có hệ quả, xem mục 4.
- Nguồn dữ liệu **miễn phí trước**.

---

## 2. Thứ ĐÃ CÓ, chạy được, có cổng canh

Tầng dữ liệu nằm trong kho HQ (`pseo-control-panel`), không nằm trong publisher:

| file | nội dung |
| --- | --- |
| `lib/football/openfootball.ts` | 5 giải quốc nội, nền JSON + đối chiếu chéo |
| `lib/football/openfootball-txt.ts` | parser bản .txt (lớp phủ kết quả mới) |
| `lib/football/ucl-archive.ts` | Champions League, 15 mùa lưu trữ |
| `lib/football/season.ts` | suy mùa hiện tại từ ngày, mốc tháng 7 |
| `lib/football/cached.ts` | lớp đệm cho trang — **chỉ Next dùng, script KHÔNG import** |
| `scripts/verify-openfootball.ts` | `npm run verify:openfootball` |
| `scripts/verify-ucl-archive.ts` | `npm run verify:ucl-archive` |

Trang xem: `/markets?country=vn` (và `?ucl=1` để mở bảng 15 mùa).

**Số đo 22/9/2026:**

| giải | đội | trận/mùa | đã đá | trễ | nguồn |
| --- | --- | --- | --- | --- | --- |
| Ngoại hạng Anh | 20 | 380 | 50 | 2 ngày | hai nguồn |
| La Liga | 20 | 380 | 69 | 2 ngày | hai nguồn |
| Serie A | 20 | 380 | 50 | 2 ngày | hai nguồn |
| Bundesliga | 18 | 306 | 36 | 2 ngày | hai nguồn |
| Ligue 1 | 18 | 306 | 36 | **9 ngày** | **một nguồn** |
| Champions League | — | — | — | — | **chỉ lưu trữ, 15 mùa** |
| V.League 1 | — | — | — | — | **không có nguồn** |

Tổng: **96 đội, 1.752 trận mỗi mùa, 876 cặp đối đầu** ở 5 giải quốc nội; cộng
**1.997 trận trong 15 mùa C1** đã kết thúc.

Độ trễ 2 ngày khớp đúng yêu cầu "chấp nhận trễ 1 ngày" ở mức xấp xỉ — nhưng
nó là độ trễ *đo được hôm nay*, không phải cam kết. `stalenessDays` đi kèm mọi
lần đọc; trang publisher phải đọc nó chứ đừng giả định.

---

## 3. Thứ KHÔNG CÓ — và đây là phần quan trọng nhất của tài liệu này

### 3.1 Không có bất kỳ dữ liệu cầu thủ nào

**"Phong độ cầu thủ" không dựng được từ nguồn hiện tại.** Đo 22/9/2026:

- File trận của openfootball **không có người ghi bàn, không có đội hình,
  không có phút thi đấu**. Chỉ có: vòng, ngày, giờ, hai đội, tỷ số hiệp
  một/chung cuộc (và hiệp phụ/luân lưu ở cúp).
- Kho `openfootball/players` **không phải dữ liệu thống kê**. Mỗi dòng là:
  tên, vị trí, chiều cao, ngày và nơi sinh. Không có CLB, không có số trận,
  không có bàn thắng. Anh 3.487 cầu thủ, Tây Ban Nha 2.182 — và **Việt Nam
  đúng 1 cầu thủ** (Nguyễn Quang Hải).

Nghĩa là mọi trang kiểu "phong độ Haaland 5 trận gần nhất" sẽ phải **bịa số**
nếu dựng bằng nguồn hiện tại. Đây là lằn ranh: kho này đã có cả một tầng
validator chống bịa fact, và nó tồn tại vì đúng loại cám dỗ này.

**Hai đường ra, cần chủ dự án quyết:**

1. `football-data.org` — có endpoint `scorers` cho một số giải. **Gói miễn phí
   phải tự đăng ký tài khoản**; tôi không tạo tài khoản thay được. Có token
   rồi thì việc đầu tiên là **đo phủ sóng thật của gói miễn phí** trước khi
   viết adapter — đừng tin trang giới thiệu.
2. **Bỏ hẳn nội dung cấp cầu thủ ở giai đoạn 1**, chỉ làm cấp ĐỘI. Toàn bộ
   mục 4 dưới đây là cấp đội và dựng được ngay hôm nay.

### 3.2 Không có V.League

openfootball không có giải Việt Nam. Nguồn miễn phí duy nhất tìm được là
TheSportsDB, và nó trả về Wigan Athletic, Blackpool, Leicester làm đội
V.League 1 — **dữ liệu sai chứ không phải thiếu**, nên không dùng được kể cả
để lấp tạm.

Đây là lỗ hổng nghịch lý nhất của dự án: thị trường là Việt Nam, mà giải trong
nước lại là thứ duy nhất không có dữ liệu.

### 3.3 Không có lịch thi đấu sắp tới trong phạm vi giai đoạn 1

Chủ dự án đã chốt "chưa tích hợp lịch thi đấu". Thực ra **dữ liệu lịch thì
CÓ** — file mùa chứa cả 380 trận, trận chưa đá thì `fullTime: null`. Cái chưa
có là *quyết định dùng nó*.

Hệ quả nằm ở mục 4.2: nó quyết định "nhận định" là loại nội dung gì.

---

## 4. Nội dung dựng được ngay, và số trang mỗi loại

### 4.1 Số liệu phân tích cấp ĐỘI — dựng được 100% hôm nay

Mọi chỉ số dưới đây suy ra từ kết quả trận + tỷ số hiệp một, không cần nguồn
mới. Đo thật trên Ngoại hạng Anh sau 50 trận (22/9/2026):

| chỉ số | giá trị đo được |
| --- | --- |
| tài xỉu 2.5 bàn | 26/50 trên (52%) |
| hai đội cùng ghi bàn | 25/50 (50%) |
| chủ nhà thắng | 18/50 (36%) |
| lội ngược dòng sau hiệp một | 2 trận |
| dẫn đầu | Manchester City FC, 15đ (5-0-0) |

Còn dựng được: phong độ N trận gần nhất theo đội, tách sân nhà/sân khách, giữ
sạch lưới, bàn thắng theo hiệp, chuỗi thắng/hoà/thua, bảng xếp hạng theo thời
điểm.

**Lưu ý dữ liệu:** 224/241 trận đã đá biết tỷ số hiệp một. 17 trận thiếu đều
là trận 0-0 — nguồn suy hiệp một từ phút ghi bàn nên trận không bàn nào thì
không suy được. `halfTime: null` là "không biết", **không phải 0-0**. Trang nào
hiện chỉ số theo hiệp phải xử lý ca không biết, đừng điền 0.

**Số trang ước tính:**

| trục trang | số trang / mùa |
| --- | --- |
| trang đội | 96 |
| trang trận (báo cáo sau trận) | 1.752 |
| trang đối đầu (cặp đội trong giải) | 876 |
| trang giải + vòng đấu | ~5 + ~190 |
| **C1 lưu trữ** | 15 mùa + 1.997 trận + trang CLB |

### 4.2 "Nhận định kết quả trận đấu" = bài SAU TRẬN — đã chốt

Chủ dự án xác nhận ngày 22/9/2026: **nhận định sau trận, không phải dự đoán
trước trận.** Khớp với việc hoãn tích hợp lịch thi đấu. Không cần hỏi lại.

**Một trang sau trận dựng được những gì — ví dụ chạy thật trên trận mới nhất
của Ngoại hạng Anh (đo 22/9/2026):**

```
Matchday 5 · 20/9/2026
Fulham FC 1-1 Manchester United FC   (hiệp một 0-0)

Fulham FC             hạng 20 -> 19   phong độ trước trận  B B B H
Manchester United FC  hạng 13 -> 12   phong độ trước trận  B T H B
đối đầu trong mùa: 1 trận
```

Thứ tự hạng **trước và sau trận** không có sẵn trong nguồn — nó tính ra bằng
cách dựng bảng xếp hạng trên tập trận có ngày nhỏ hơn ngày trận đó, rồi dựng
lại lần nữa có tính trận đó. `buildStandings()` nhận vào một tập trận bất kỳ
nên việc này không cần thêm dữ liệu, chỉ cần lọc.

Danh sách đầy đủ những gì suy ra được cho mỗi trận:

- tỷ số chung cuộc và hiệp một, ngày, vòng đấu
- hạng hai đội trước và sau trận, điểm trước và sau
- chuỗi phong độ N trận gần nhất của mỗi đội **tính tới trước trận đó**
- chuỗi bị cắt hay được kéo dài (thắng/bất bại/không thắng)
- đối đầu giữa hai đội trong mùa, và trong 15 mùa C1 nếu là trận C1
- trận có lội ngược dòng sau hiệp một hay không
- tổng bàn, tài xỉu 2.5, hai đội cùng ghi bàn
- bất ngờ hay không, so với khoảng cách hạng trước trận

**Không suy ra được, và đây đúng là thứ người đọc mong thấy nhất trong một bài
nhận định:** ai ghi bàn, phút ghi bàn, kiến tạo, thẻ phạt, đội hình ra sân,
thay người, kiểm soát bóng, số cú sút. Xem mục 3.1 — không có nguồn nào trong
tay cho những thứ này.

**Hai điều về vận hành, nêu một lần để lượng hoá chứ không để bàn lại:**

1. Độ trễ đo hôm nay là **2 ngày**, không phải 1 — và **Ligue 1 là 9 ngày**.
   Chủ dự án chấp nhận trễ 1 ngày; con số thật đang lớn hơn thế và thay đổi
   theo ngày. Trang phải đọc `stalenessDays` mà hiển thị, đừng viết "cập nhật
   hôm nay" theo thời điểm dựng trang.
2. Truy vấn sau trận là truy vấn TIN TỨC: nó dâng lên trong vài giờ sau tiếng
   còi rồi tắt. Đăng sau 2 ngày nghĩa là vào cuộc khi đỉnh đã qua. Trang số
   liệu cấp đội (mục 4.1) thì không chịu ràng buộc đó — cùng một bộ dữ liệu
   nhưng một loại có hạn dùng vài giờ, loại kia đọc được quanh năm.

   Hệ quả thực dụng: **đừng đặt cược lưu lượng vào 1.752 bài sau trận mỗi
   mùa**. Chúng là lớp nội dung nền, còn trang đội và trang đối đầu mới là
   phần có thể xếp hạng lâu dài.

**Cảnh báo về độ mỏng.** 1.752 bài mỗi mùa dựng từ một tỷ số sẽ rất giống
nhau nếu chỉ đổi tên đội và con số. Kho này đã có sẵn hai cổng cho đúng bệnh
đó — cổng khác biệt hoá (differentiation gate) và `verify:content-rules` —
phải bật chúng cho niche này TRƯỚC khi sinh hàng loạt, không phải sau.

## 5. Thứ publisher hiện tại KHÔNG dùng lại được

Đây là phần dễ mất thời gian nhất nếu không biết trước.

**Toàn bộ pipeline publisher hiện tại xoay quanh trục MÃ ZIP CỦA MỸ.**

- `Location` có `@@unique([zip])`, `state` không nullable, **không có cột
  quốc gia**.
- `MarketIdentity` có `@@unique([zip, vertical])`.
- `lib/publisher/niche-readiness.ts` có hẳn một phép kiểm tên `zip-axis`.
- `lib/content-spec/niche-spec.ts` dùng placeholder `{zip} {place} {county}`.
- Cổng `verify:content-rules` đòi từ khoá đăng ký trong registry của HQ.

Trục trang của bóng đá là **giải / mùa / đội / trận**, không có chỗ nào ánh xạ
sang zip. Nên việc đầu tiên của session mới **không phải viết nội dung** mà là
quyết định: mở rộng trục hiện tại, hay dựng một nhánh trục riêng cho site
không có địa lý.

Những thứ khác thì dùng lại được và nên dùng lại:

- Cổng đọc **HTML đã render** (`scripts/verify-rendered.ts` bên publisher) —
  nó bắt được thứ đọc mã không thấy. Sẽ cần sửa `FOREIGN_WORDS` cho tiếng
  Việt: hiện nó canh việc site này dùng từ vựng của ngành kia.
- Chốt canonical trỏ về chính nó, chống trang mù (`OWN_WORD`).
- Lớp chặn gtag ở localhost và trình duyệt tự động.
- Mô hình **một kho publisher phục vụ mọi site, phân biệt bằng Host header**.
  Không tạo kho riêng cho site Việt Nam — đã có người làm vậy một lần và phải
  xoá đi (xem `AGENTS.md` mục 3).

---

## 6. Ba cái bẫy đã trả giá, đừng trả lại

1. **Một phép thử âm chỉ bác được đúng thứ nó thử.** Tôi viết "Champions
   League không có bản JSON" sau khi thử `cl.json` và nhận 404. Tên thật là
   `uefa.cl.json`, có sẵn cho 10 mùa. Trước khi kết luận "nguồn X không có Y",
   liệt kê cả cây thư mục chứ đừng thử một điểm.

2. **Số đúng, thứ tự sai, không validator nào bắt.** Bảng lưu trữ C1 đặt cột
   "Vô địch" trước "Á quân" nhưng tỷ số lấy theo thứ tự chủ-khách, nên hiện
   "Chelsea vô địch … 1-1 (luân lưu 3-4)". Mọi con số đều đúng. Chỉ nhìn trang
   mới thấy. 4/15 mùa bị vậy.

3. **Lỗi parser im lặng nuốt dữ liệu vào tên.** Dòng có hiệp phụ/luân lưu
   không khớp biểu thức cũ, và phần thừa bị nuốt vào tên đội khách, tạo ra
   đội tên `"Paris Saint-Germain FC (FRA)  1-4 pen. …"`. 11 trận trong 6 mùa,
   không một dòng lỗi nào. Bất biến cứu được nó: **mọi tên đội C1 phải kết
   thúc bằng `(XXX)`**.

Và bài học chung của cả ba: cổng canh phải so dữ liệu với **thực tế**, không
chỉ so với chính nó. Bảng nhà vô địch viết tay 14 mùa là phép kiểm duy nhất
trong `verify-ucl-archive.ts` làm được điều đó.

---

## 7. Thứ tự nên làm

1. **Quyết trục trang** cho site không có địa lý (mục 5). Đây là việc đầu
   tiên, trước khi viết bất kỳ template nào.
2. Dựng giai đoạn 1 **chỉ cấp đội** từ dữ liệu đang có — không chờ nguồn mới.
   Ưu tiên trang đội và trang đối đầu (đọc được quanh năm) trước bài sau trận
   (có hạn dùng vài giờ).
3. Bật cổng khác biệt hoá và `verify:content-rules` cho niche này **trước**
   khi sinh hàng loạt.
4. Song song: chủ dự án đăng ký token `football-data.org`, rồi **đo phủ sóng
   thật** trước khi hứa bất kỳ nội dung cấp cầu thủ nào.
5. V.League để mở. Không lấp bằng TheSportsDB.
