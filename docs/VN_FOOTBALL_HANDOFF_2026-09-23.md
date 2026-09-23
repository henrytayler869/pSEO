# Bàn giao publisher bóng đá Việt Nam — 23/9/2026

Tiếp nối `VN_FOOTBALL_PUBLISHER_BRIEF.md` (22/9). Brief đó trả lời "dựng được
gì"; file này trả lời "đã dựng xong gì, còn gì, và chỗ nào đã trả giá".

---

## 1. `verify:rendered` — ĐÃ GIẢI QUYẾT, cổng XANH

Phiên HQ có thông tin cũ khi hỏi câu này. Trạng thái cuối, đo trên build thật
với `HQ_API_BASE` trỏ **production**:

```
Rendered pages — 674 trang cụ thể
  (bỏ qua 10 shell route động, và 626 vỏ trang không có nội dung)
✓ 12/12 phép kiểm về 0
```

### Vì sao phép so "395 vs nhánh của anh" không kết luận được

Phiên HQ build `origin/main` với `HQ_API_BASE` **mặc định = production** và
được 395 trang. Tôi build nhánh mình với `HQ_API_BASE` trỏ **HQ dev cục bộ
cổng 3010** — một dev server đọc DB qua tunnel SSH. Log:

```
Error: Filling a cache during prerender timed out
  /atmovingservices.com/moving-services/ny/brooklyn
```

Timeout, không phải lỗi mã. Hai phép đo ở hai điều kiện khác nhau, và tôi đã
so chúng như thể cùng điều kiện trong hai lượt.

Build lại đúng điều kiện: **atmovingservices 226, theaccidentrecord 150** —
khớp từng con số với baseline 395 của họ. **Không có hồi quy nào** ở hai site
đang sống.

### Ba nguyên nhân THẬT, tìm ra lần lượt

Mỗi cái chỉ lộ sau khi sửa cái trước.

1. **`headers()` trong `app/not-found.tsx`** → API động, và `not-found` nằm
   trong cây của MỌI route, nên cả site thành render-lúc-request. Build ra
   đúng **1** file HTML. Bỏ ra → 1.038.

2. **`fetchEntityDataset` thiếu ranh giới `use cache`** → 983 file HTML **0
   byte**. `use cache` ở đây KHÔNG phải để đi nhanh, nó là điều kiện để trang
   prerender được. Trang ZIP không dính vì `lib/hq/client.ts` mọi hàm đều mở
   đầu bằng `"use cache"`. Sau khi bọc: rỗng 983 → 11, trang bóng đá >1KB
   9 → 981.

   Và 972 "không canonical / không JSON-LD / title trùng" hoá ra là BA TRIỆU
   CHỨNG của cùng nguyên nhân này — file rỗng thì không có gì cả.

3. **Bốn chỗ tôi bỏ sót**: `generateMetadata` chưa rẽ nhánh theo trục;
   `EntityView` chưa hề có JSON-LD; `EntityHome` thiếu JSON-LD; `has: { faq }`
   khai quan hệ tới node FAQPage không được phát ra (346 cạnh trỏ hụt).

### Cổng đếm 626 trang 404 hợp lệ như trang hỏng — đã sửa, và mất BA lần

626 cặp đối đầu chưa gặp nhau gọi `notFound()` đúng thiết kế; Next để lại vỏ
12KB không `<title>`, không `<h1>`, không canonical.

```
lần 1  html.includes("No page at that address")
       -> khớp MỌI trang (Next nhúng not-found vào payload từng trang)
       -> bỏ qua 1.296/1.300 rồi báo XANH
lần 2  so <h1> đã render   -> khớp 0 (các tệp này không có <h1>)
lần 3  thiếu ĐỦ BA dấu hiệu title+h1+canonical  -> 626, đúng
```

Hai lần đầu sai vì tôi GIẢ ĐỊNH các tệp ấy chứa markup trang 404. Chúng không
chứa; chỉ mở một tệp ra xem mới biết.

**Thứ cứu một lần báo sai với chủ dự án là dòng đếm số trang bỏ qua.** Lần 1
in "✓" và tôi suýt nói cổng xanh. Giữ dòng đó — nó khiến cổng tự chịu đúng
luật nó áp cho người khác.

---

## 2. Trạng thái trục thực thể

### Đã xong, đã đẩy

| | |
| --- | --- |
| `EntityIdentity` + `AiEntityGeneration` | migration trên main, **977 hàng** ở DB production |
| Tầng chỉ số | `lib/football/facts.ts`, đối chiếu chéo `buildStandings` trên 96/96 đội |
| Đặc tả nội dung | `lib/content-spec/entity-spec.ts`, 3 loại trang, cổng đối chiếu HAI CHIỀU |
| Tầng sinh văn AI | prompt + validator riêng; **351 trang có văn đã kiểm, $5,89, 0 trượt** |
| API | `/entities`, `/entities/{key...}`, `/entity-spec` |
| Publisher | trang chủ, hub, trang đội, trang đối đầu, 6 trang tĩnh, 404 — tất cả tiếng Việt |
| Banner | `components/ad-slot.tsx`, giữ chỗ đúng kích thước IAB, chưa gọi mạng nào |

Năm cổng mới ở HQ: `verify:page-axis`, `verify:football-facts`,
`verify:entity-spec`, `verify:entity-validator`, `readiness`.
Lệnh vận hành: `football:sync`, `entity:generate`, `entity:batch`,
`entity:distinctness`, `entity:export`.

### Đang dở

- **`data/sites/bongda.invalid/` đã bị gỡ khỏi main** (pseo-publisher #88).
  Lý do đúng: site chỉ xem được ở localhost mà nằm trong build thì mọi CI đi
  hỏi HQ config và nhận 403. Khôi phục: lấy lại thư mục từ nhánh
  `vn-football-publisher`, đổi `host` trong `site.json` **và** tên thư mục
  sang domain thật, rồi `npm run data:index`.
- **Cấu hình host đó vẫn còn trong `scripts/verify-rendered.ts`** —
  `FOREIGN_WORDS` và `OWN_WORD: "trận"`. Phiên HQ giữ lại có chủ ý; đó là công
  thức cho lúc site quay về.
- **626 cặp chưa gặp nhau** sẽ tự có nội dung khi mùa tiến. Chạy lại
  `entity:batch` mỗi vòng đấu; cache chính là sổ tiến độ.
- **`entity:export` là đường đi vòng.** Đường chính thức `hq:entities` cần
  khoá API, cần hàng `Website`, cần GSC/GA4 — tức cần domain.

### Ba cái bẫy đã trả giá, đừng trả lại

1. **Hàm QC viết cho tiếng Anh không dùng được cho tiếng Việt.**
   `longestSharedPhrase` cắt "bảng xếp hạng" thành `b|ng|x|p|h|ng` — đếm phồng
   gấp đôi và đụng giả. `extractNumbers` đọc `"52,0%"` thành **520**. Cả hai
   vẫn CHẠY, chỉ trả lời sai. Bản tiếng Việt ở `lib/ai/entity-distinctness.ts`
   và `lib/ai/entity-validate.ts`. Đã ghi vào AGENTS.md.

2. **`fetchLeagueSeason` vs `fetchLeagueSeasonMerged`** — cùng ngày cùng giải:
   40 trận/trễ 8 ngày so với 50 trận/trễ 2 ngày. Không gì đỏ lên khi gọi nhầm.

3. **Ngưỡng khác biệt hoá phải đo trên TOÀN BỘ dân số.** Mẫu 8 → cực đại 24;
   mẫu 24 → 27; toàn bộ 4.560 cặp → 41, trong khi trung vị GIẢM 11→9→8. Cái
   đuôi là trùng SỐ (hai đội cùng bộ số), không phải trùng khuôn — nên cổng
   canh **trung vị**, không canh đuôi.

---

## 3. Domain

Chưa mua. Đây là thứ chặn mọi việc còn lại: không domain → không GSC/GA4 →
không hàng `Website` → không khoá API → không `hq:entities`, và không phép đo
index nào.

**Ràng buộc quan trọng nhất: tránh mọi tên gợi cá cược** (`soikeo`, `keo`,
`tyle`, `nhacai`). Ba lý do, cả ba đã nằm trong mã:

- validator CẤM từ vựng đó; nội dung site từ chối viết kiểu ấy
- nó kéo về đúng ý định site không phục vụ được, mà brief đã chẩn đoán nghẽn
  traffic là **lệch ý định**
- doanh thu là banner, và mạng quảng cáo soi kỹ nội dung liên quan cờ bạc

Gợi ý, **chưa kiểm tình trạng còn trống**:

| nhóm | tên |
| --- | --- |
| mô tả đúng nội dung | `solieubongda.com`, `thongkebongda.com`, `bongdasolieu.com` |
| ngắn, dễ nhớ | `bongdadata.com`, `sancostats.com` |

**Tránh** `bongdaso.com` và biến thể quanh "bóng đá số" — thương hiệu bóng đá
Việt Nam đã có tiếng; rủi ro nhầm lẫn và nhãn hiệu.

`.com` hợp hạ tầng hiện tại (HQ tạo zone Cloudflare tự động). `.vn` cho tín
hiệu địa phương tốt hơn nhưng đòi hồ sơ pháp nhân và bước provisioning sẽ
không tự động được.

---

## 4. Việc nhỏ còn mở

- Thân hub niche đã liệt kê 5 giải; **không** còn việc gì ở đó.
- `verify:niche-label` đã đăng ký vào `package.json` (trước đó script tồn tại
  nhưng không gọi được bằng `npm run` — một cổng không gọi được là một cổng
  không tồn tại).
- Trang 404 dùng chữ TRUNG TÍNH cho mọi site. Muốn 404 theo từng site thì cần
  một cơ chế KHÁC `not-found.tsx` — nó không nhận `params` ở bất kỳ cấp nào,
  và thêm một API động vào đó sẽ tắt prerender toàn site (xem mục 1).
