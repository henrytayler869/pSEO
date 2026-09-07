# Hướng dẫn dựng website kết nối vào Head Quarter (pSEO Control Panel)

> **Tài liệu bàn giao.** Đưa file này cho session Claude Code đang dựng
> website thật. Nó mô tả *hợp đồng* giữa website và Control Panel
> ("Head Quarter"): website lấy dữ liệu ở đâu, dữ liệu có hình dạng gì,
> Head Quarter cần gì ngược lại từ website.
>
> Mọi ví dụ response trong tài liệu này đều **chụp từ API thật đang chạy**
> (2026-09-06), không phải shape tự nghĩ ra.

**Bản 6 — 2026-09-07** (sau đợt 5 việc lớn):
> - **Nguồn mới `census_mobility`** (ACS B07003): số người chuyển nhà theo
>   từng zip — dữ liệu cấp ZIP đầu tiên đo đúng hành vi của niche này. Xem §4.
> - **Trường mới**: `metro`/`cbsaCode` (CBSA), `lat`/`lon`, `countyKeyword`.
> - **§3.6 mới**: `countyKeyword` và cách dùng "từ khoá hiệu dụng" — kèm
>   cảnh báo nó KHÔNG thay thế `mainKeyword`.
> - Sửa mẫu sinh từ khoá cho 7 niche khác; `mainKeyword` của nhiều market
>   đã đổi (dùng `keywordMeasuredAt` để phát hiện).
>
> **Bản 5 — 2026-09-07**:
> - Thêm `keywordMeasuredAt` vào cả hai endpoint (§3.5).
> - Thêm cảnh báo **trường mới phải coi là optional một chu kỳ deploy** —
>   sau một ca thật: consumer cache response, build validate body cũ, lỗi
>   hàng loạt trong khi API hoàn toàn bình thường.
> - Thêm quy tắc §7.9: **mở rộng tập dữ liệu cũng cần verify**, không phải
>   cải thiện đơn thuần.
>
> **Bản 4 — 2026-09-07** (sau vòng sửa `buildKeywordPattern`):
> - **Sửa mẫu sinh từ khoá.** Trước đây cố định `"{niche} {place}"`, giờ đo
>   nhiều cách viết mỗi địa danh và lấy cái có cầu thật cao nhất. Kết quả
>   trên moving-services: buildable **155 → 256**, market không đo được cầu
>   **175 → 44**, KD trung bình **16,2 → 7,9**. Mọi số ở §3.4 bên dưới là
>   của bản 3 và **đã cũ** — số hiện tại ở đầu §3.4.
> - **Thêm §3.5: trường nào bền, trường nào đổi được.** Viết sau một sự cố
>   thật do tài liệu này mô tả `mainKeyword` như một định danh.
>
> **Bản 3 — 2026-09-07** (đính chính số liệu, theo phản hồi từ session dựng site):
> - **Sửa số ở §3.4.** Bản 2 ghi "101 standalone / 199 trong cụm / 53 cụm",
>   tính sai mẫu số (dùng "300 zip có Location" thay vì "zip dựng được
>   trang"). Số đúng đã kiểm chứng: **155 buildable → 49 standalone, 106
>   trong cụm, 21 cụm (68%)**.
> - Tách rõ **hai trạng thái rỗng** ở §3.3: `404` không có keyword (175 zip)
>   ≠ `governmentData: []` (252 zip). Gộp chung là nhãn sai.
>
> **Bản 2 — 2026-09-06**:
> - Thêm `county` + `countyFips` vào **cả hai** endpoint. Bản 1 có ví dụ
>   dùng tên hạt trong khi API không trả về tên hạt — **lỗi của tài liệu**,
>   đã sửa ở cả hai đầu.
> - Thêm §3.4 về cụm zip trùng lặp.

---

## 1. Phân chia trách nhiệm

Head Quarter **không** dựng trang, **không** publish, **không** phân tích
SEO từng trang. Nó chỉ làm 3 việc và website phải tự làm phần còn lại.

| Việc | Ai làm |
|---|---|
| Nghiên cứu niche, chấm điểm thị trường theo từng zip | Head Quarter |
| Thu thập dữ liệu chính phủ thật theo zip (Census, IRS, FEMA, PVWatts…) | Head Quarter |
| Xác thực dữ liệu (outlier, completeness, schema drift) trước khi phát ra | Head Quarter |
| Đăng ký domain vào Cloudflare | Head Quarter (`/domains`) |
| **Quyết định dựng trang nào, viết nội dung, render, publish** | **Website** |
| **SEO on-page, internal link, tối ưu title/meta** | **Website** |
| **Sitemap, robots.txt, schema.org** | **Website** |
| Theo dõi số bài viết / index rate / traffic của website | Head Quarter (`/publisher`, đọc live) |

Nói cách khác: **Head Quarter là nguồn dữ liệu + bảng theo dõi. Website là
nơi sản xuất và sở hữu nội dung.**

---

## 2. Kiến trúc website cần dựng

- **CMS**: headless WordPress (chỉ dùng làm kho nội dung + REST API)
- **Frontend**: Next.js
- **Rendering**: **ISR + on-demand revalidation** — không dùng
  `output: 'export'`.
  Lý do: site pSEO sẽ có hàng trăm đến hàng nghìn trang; rebuild + redeploy
  toàn bộ mỗi lần sửa 1 bài là không khả thi. ISR cho kết quả phục vụ như
  HTML tĩnh nhưng regenerate được từng trang.
  Luồng: WordPress publish hook → gọi API route của Next.js →
  `revalidatePath()` / `revalidateTag()` cho đúng trang đó.

### Yêu cầu bắt buộc để Head Quarter theo dõi được

Website **phải** để lộ WordPress REST API công khai ở:

```
https://<domain>/wp-json/wp/v2/posts
```

Head Quarter đếm số bài đã publish bằng header `X-WP-Total` từ request
`?per_page=1`. Nếu bạn đặt `/wp-json` ở subdomain khác (headless tách
riêng), vẫn được — khi kết nối ở `/publisher` có ô "WP REST API base" để
ghi đè.

> Đừng chặn `/wp-json` bằng plugin bảo mật, nếu không Head Quarter sẽ báo
> lỗi ở cột "Bài viết".

---

## 3. Dataset API — nguồn dữ liệu cho website

Base URL: `http://<host-control-panel>:3000/api/v1`
(khi deploy thật thì thay bằng domain nội bộ của Control Panel)

### Xác thực

Mọi request phải kèm API key, một trong hai cách:

```
Authorization: Bearer <key>
```
hoặc
```
X-Api-Key: <key>
```

Key lấy ở Control Panel → **Cài đặt** → "Cổng API (cho plugin/website)" →
*Tạo lại*. Chỉ tồn tại **một key tại một thời điểm** — tạo key mới sẽ thu
hồi key cũ ngay, mọi nơi đang dùng key cũ sẽ ngừng hoạt động.

Sai key → `401`:
```json
{ "error": "Unauthorized — provide a valid API key via 'Authorization: Bearer <key>' or 'X-Api-Key' header." }
```

---

### 3.1 `GET /api/v1/niches` — danh sách niche đã nghiên cứu

Dùng để biết Head Quarter đang có sẵn dữ liệu cho những niche nào.

**Response thật** (rút gọn còn 2 phần tử):

```json
{
  "niches": [
    {
      "vertical": "auto-accident-attorney",
      "rank": 1,
      "marketCount": 582,
      "scoredMarketCount": 369,
      "avgScore": 50256.356316909136,
      "avgCpc": 136.67420054200525,
      "avgKeywordDifficulty": 22.341463414634145,
      "totalSearchVolume": 1165070
    },
    {
      "vertical": "moving-services",
      "rank": 2,
      "marketCount": 582,
      "scoredMarketCount": 407,
      "avgScore": 18558.534869659452,
      "avgCpc": 25.087100737100677,
      "avgKeywordDifficulty": 16.203931203931205,
      "totalSearchVolume": 2357630
    }
  ]
}
```

Lưu ý:
- `marketCount` = tổng số zip đã tạo cho niche. `scoredMarketCount` = số zip
  thật sự có dữ liệu từ khoá và đã chấm điểm. **Chênh lệch là bình thường**
  — nhiều zip không có đủ volume tìm kiếm để chấm điểm.
- `rank` 1 = niche tốt nhất theo điểm trung bình.

---

### 3.2 `GET /api/v1/niches/{vertical}/markets` — mọi zip của một niche

Dùng để liệt kê "có thể dựng những trang nào".

**Response thật** (`moving-services`, rút gọn — thật sự trả về 582 phần tử):

```json
{
  "vertical": "moving-services",
  "markets": [
    {
      "zip": "78201",
      "city": "San Antonio",
      "state": "TX",
      "county": "Bexar County",
      "countyFips": "48029",
      "mainKeyword": "moving services san antonio",
      "searchVolume": 5400,
      "cpc": 21.92,
      "keywordDifficulty": 0,
      "score": 118368
    }
  ]
}
```

- Sắp xếp sẵn theo `score` giảm dần → phần tử đầu là zip đáng dựng trang
  nhất.
- `score` có thể `null` (zip chưa có dữ liệu từ khoá) — **phải xử lý**,
  đừng giả định luôn là số.
- `keywordDifficulty: 0` là **giá trị thật hợp lệ** từ DataForSEO, nghĩa là
  "không cạnh tranh" — không phải thiếu dữ liệu. Đừng lọc bỏ nó.
- `county` / `countyFips` có thể `null` = zip chưa có trong bảng Location
  (282/582 zip của moving-services). `null` ⇒ chắc chắn `governmentData: []`
  ở endpoint chi tiết, nên dùng làm bộ lọc rẻ tiền để loại trước khi gọi
  chi tiết. **Chiều ngược lại không đúng**: có `countyFips` *không* đảm bảo
  có `governmentData` — chỉ 155/300 zip có Location thật sự dựng được trang
  (xem phễu ở §3.4).
- **Dùng `(mainKeyword, countyFips)` để phát hiện cụm trùng lặp trước khi
  dựng trang** — xem §3.4, đây là bước bắt buộc.
- Niche không tồn tại → `404 { "error": "No researched markets found for vertical \"...\"." }`

---

### 3.3 `GET /api/v1/niches/{vertical}/markets/{zip}` — dataset đầy đủ cho 1 trang

**Đây là endpoint chính để dựng một trang.**

**Response thật** (`moving-services` / `10002`):

```json
{
  "vertical": "moving-services",
  "zip": "10002",
  "city": "New York",
  "state": "NY",
  "county": "New York County",
  "countyFips": "36061",
  "mainKeyword": {
    "keyword": "moving services new york",
    "searchVolume": 18100,
    "cpc": 41.9,
    "keywordDifficulty": 49
  },
  "nationalBaseline": {
    "searchVolume": 5792.70,
    "cpc": 25.08,
    "keywordDifficulty": 16.20
  },
  "semanticKeywords": [
    { "keyword": "moving services near me",        "searchVolume": 14800, "cpc": 21.86, "keywordDifficulty": 17 },
    { "keyword": "moving services cross country",  "searchVolume": 14800, "cpc": 83.58, "keywordDifficulty": 29 },
    { "keyword": "moving help",                    "searchVolume": 12100, "cpc": 11.50, "keywordDifficulty": 38 },
    { "keyword": "local moving services",          "searchVolume": 6600,  "cpc": 21.19, "keywordDifficulty": 21 },
    { "keyword": "moving services prices",         "searchVolume": 2900,  "cpc": 15.92, "keywordDifficulty": 10 },
    { "keyword": "u haul moving services",         "searchVolume": 1000,  "cpc": 9.15,  "keywordDifficulty": 31 }
  ],
  "governmentData": [
    {
      "sourceName": "Census ACS5 (housing & income)",
      "adapterKey": "census_acs_housing",
      "metric": "census_median_home_value_usd",
      "value": 808500,
      "unit": "USD",
      "resolvedAtResolution": "ZIP",
      "isInferred": false,
      "confidence": 0.9,
      "snapshotVersion": 1,
      "fetchedAt": "2026-09-06T09:06:35.416Z"
    },
    {
      "sourceName": "IRS SOI County Migration",
      "adapterKey": "irs_migration",
      "metric": "irs_migration_net_households",
      "value": 2935,
      "unit": "households/yr",
      "resolvedAtResolution": "COUNTY",
      "isInferred": true,
      "confidence": 0.85,
      "snapshotVersion": 1,
      "fetchedAt": "2026-09-06T09:41:50.021Z"
    }
  ],
  "score": 15477.34693877551,
  "scoreVersion": 2,
  "lastUpdated": "2026-09-06T10:46:45.703Z"
}
```

#### Cách dùng từng trường

| Trường | Dùng để làm gì |
|---|---|
| `county` / `countyFips` | Tên hạt thật + mã FIPS. Dùng để (a) ghi đúng phạm vi cho chỉ số `isInferred`, (b) phát hiện cụm zip trùng lặp (§3.4). `county` có thể `null` — xem cảnh báo bên dưới |
| `lat` / `lon` | Toạ độ tâm ZCTA (Census Gazetteer), phủ **100% market có Location**. **Chỉ dùng để sắp xếp** (vd: liên kết nội bộ theo khoảng cách thật thay vì theo bang). **Không được in ra số suy từ nó** — khoảng cách bạn tự tính là số của bạn, không phải số đo được (§7.1) |
| `mainKeyword` | Từ khoá chính của trang — dùng cho `<title>`, `<h1>`, URL slug. ⚠️ **Là giá trị ĐO ĐƯỢC, không phải định danh** — xem §3.5 |
| `countyKeyword` | Từ khoá đo cho **cấp county**, khi county đó có tên người ta thật sự tìm (hiện chỉ 5 borough NYC). Thường `null`. **Là trường RIÊNG, không thay thế `mainKeyword`** — xem §3.6 |
| `nationalBaseline` | Trung bình toàn quốc của niche. **Dùng để so sánh**: "nhu cầu ở New York cao gấp 3 lần trung bình cả nước" là câu có dữ liệu thật đứng sau |
| `semanticKeywords` | Từ khoá liên quan thật (DataForSEO Labs). Dùng làm dàn ý `<h2>`/`<h3>` và phủ chủ đề. **Lấy chung cho cả niche, không riêng theo zip** |
| `governmentData` | Dữ liệu chính phủ thật cho zip này — phần tạo khác biệt thật giữa các trang |
| `score` | Điểm cơ hội SEO. Dùng để ưu tiên dựng trang nào trước |

#### `governmentData` — đọc kỹ 3 trường này

- **`isInferred: true`** nghĩa là số liệu được báo cáo ở cấp **rộng hơn**
  zip (xem `resolvedAtResolution`: `COUNTY` hoặc `STATE`) rồi gán cho mọi
  zip trong phạm vi đó.
  → **Bắt buộc**: khi hiển thị, phải ghi rõ phạm vi thật. Viết "New York
  County có 2.935 hộ chuyển đến ròng mỗi năm", **không** được viết "khu vực
  10002 có 2.935 hộ chuyển đến" — đó là nói sai sự thật.

  **Lấy tên hạt ở đâu**: dùng trường `county` ở cấp cao nhất của response
  (thêm 2026-09-06). Tên này lấy từ nguồn IRS SOI thật, **không** suy ra từ
  mã FIPS.

  ⚠️ `county` **có thể là `null`** — hiện 5/300 zip (Puerto Rico, và một zip
  Connecticut do bang này đổi mã hạt sang "Planning Region"). Khi `null`,
  **không được đoán tên hạt**; viết theo kiểu không nêu tên, ví dụ "toàn
  hạt chứa ZIP 78245". Đoán tên hạt từ FIPS cũng là bịa dữ liệu.
- **`confidence`** (0–1): 0.9 = số liệu ước lượng khảo sát trực tiếp;
  0.85 = có suy diễn địa lý. Có thể dùng để quyết định có nêu con số hay
  không.
- **`fetchedAt` / `snapshotVersion`**: thời điểm dữ liệu được thu thập.
  Nên hiển thị "Số liệu cập nhật <tháng/năm>, nguồn: <sourceName>" để trang
  có tính minh bạch (tốt cho E-E-A-T).

#### `governmentData` rất thường là `[]` — không phải lỗi

Mảng rỗng nghĩa là zip đó chưa có dữ liệu chính phủ thu thập được. Nguyên
nhân thật: danh sách zip nghiên cứu từ khoá và danh sách zip thu thập dữ
liệu là **hai danh sách độc lập** (xem "Location vs. MarketIdentity" trong
README của control panel).

Đo thật trên `moving-services`: **252 zip có keyword nhưng
`governmentData: []`** — nhiều hơn cả số zip dựng được trang (155).

→ **Website phải xử lý được cả 2 trường hợp.** Gợi ý: chỉ dựng trang cho
zip có `governmentData.length > 0` (trang có dữ liệu thật, khác biệt rõ),
còn zip chỉ có từ khoá thì tạm bỏ qua — tránh sinh ra trang mỏng, giống
nhau.

⚠️ **Đây là trạng thái rỗng thứ hai, khác với `404`.** Đừng gộp hai bộ đếm:
- `404` = **không có keyword volume** (175 zip) — chưa từng được nghiên cứu đủ
- `200` + `governmentData: []` = **có keyword, chưa thu thập dữ liệu** (252 zip)

Gộp chung thành một nhãn "bỏ qua" sẽ khiến chẩn đoán sai nguyên nhân sau này.

---

## 3.4 ⚠️ Cụm zip trùng lặp — lớp AI là BẮT BUỘC, không phải tuỳ chọn

Đây là hạn chế quan trọng nhất của dataset. Phải hiểu trước khi dựng trang
hàng loạt.

**Vấn đề**: nhiều zip dùng chung từ khoá chính (`mainKeyword` sinh theo
thành phố, không theo zip) **và** chung hạt. Khi đó:
- Mọi chỉ số `resolvedAtResolution: "COUNTY"` (IRS migration, FEMA) **giống
  hệt nhau từng chữ số**.
- Chỉ các chỉ số cấp `ZIP` (Census ACS5) mới khác.

→ Trang dựng thuần bằng lớp deterministic sẽ **cùng câu chữ, chỉ khác vài
con số**. Đó chính là định nghĩa thin content / doorway pages.

**Số liệu thật đo trên niche `moving-services`** (cập nhật 2026-09-07, sau
khi sửa mẫu sinh từ khoá):

Phễu đầy đủ — chú ý **mẫu số đúng là "dựng được trang", không phải "có
Location"**:

| Bước | Số zip | (trước khi sửa từ khoá) |
|---|---|---|
| Đã nghiên cứu (`MarketIdentity`) | 582 | 582 |
| ↳ loại: không có keyword volume → API trả `404` | −44 | −175 |
| ↳ loại: có keyword nhưng `governmentData: []` | −282 | −252 |
| **Dựng được trang (buildable)** | **256** | 155 |
| → nằm trong cụm trùng lặp | **120** — 28 cụm | 106 — 21 cụm |
| → độc lập | **136** | 49 |

Sửa mẫu sinh từ khoá làm **131 market trước đây không đo được cầu nay có** —
cách viết cũ đơn giản là không tìm thấy volume ở những địa danh đó. KD trung
bình cũng giảm **16,2 → 7,9**.

> Cấu trúc cụm phụ thuộc vào `mainKeyword`, mà `mainKeyword` **đổi được**
> (§3.5). Đợt sửa này đổi chuỗi từ khoá của 233/582 market, kéo theo mọi
> khoá cụm dạng `(mainKeyword, ...)` đổi theo. Đừng lưu khoá cụm dưới dạng
> chuỗi từ khoá — tính lại từ dữ liệu mới mỗi lần đồng bộ.

> **Đính chính so với bản 2**: bản trước ghi "101 zip độc lập / 199 trong
> cụm / 53 cụm", tính trên 300 zip có `Location`. Sai mẫu số: có `Location`
> **không** đồng nghĩa dựng được trang — 145 trong số đó thiếu keyword hoặc
> chưa thu thập được dữ liệu, tức chưa bao giờ là ứng viên dựng trang. Nhiều
> "cụm" trong con số 53 cũng chứa toàn zip không dựng được (có cả một cụm 13
> zip mà **không zip nào** có keyword). Số đúng: **155 buildable, 49
> standalone, 106 trong cụm, 21 cụm.**

Nghịch lý đáng chú ý: lọc chặt hơn làm tỷ lệ cụm **tăng** (66% → 68%), vì
các cụm lớn (Brooklyn, Chicago, Bronx, Queens, Houston, LA) **buildable
toàn bộ** — đô thị lớn thì Census/IRS phủ đủ. Zip bị loại chủ yếu là zip
lẻ ở vùng thưa dân, vốn phần lớn là standalone. Nói cách khác: **phần dữ
liệu tốt nhất cũng chính là phần trùng lặp nhiều nhất.**

Các cụm lớn nhất (**tất cả đều buildable 100%** — không zip nào bị loại ở
bước lọc trên):

| Số zip | Từ khoá chung | County FIPS | Ví dụ |
|---|---|---|---|
| 23 | `moving services new york` | 36047 (Kings/Brooklyn) | 11201, 11203, 11204… |
| 14 | `moving services chicago` | 17031 (Cook) | 60608, 60614, 60617… |
| 11 | `moving services new york` | 36005 (Bronx) | 10452, 10453, 10456… |
| 9 | `moving services new york` | 36081 (Queens) | 11355, 11368, 11372… |
| 7 | `moving services houston` | 48201 (Harris) | 77036, 77084, 77095… |
| 7 | `moving services los angeles` | 06037 (LA) | 90003, 90011, 90037… |

Riêng 4 cụm New York (Brooklyn + Bronx + Queens + Manhattan) cùng dùng một
từ khoá `moving services new york` — tổng **47 zip** tranh nhau một truy vấn.

**Cách phát hiện cụm**: group theo `(mainKeyword, countyFips)`, nhưng
**chỉ trên tập buildable** — phải lọc bằng `governmentData.length > 0` từ
endpoint chi tiết trước, nếu không sẽ đếm nhầm như bản 2 của tài liệu này.
`mainKeyword` + `countyFips` có sẵn ở endpoint danh sách nên bước group
không tốn thêm request nào.

> ⚠️ **Khoá này phủ gì và KHÔNG phủ gì — đọc trước khi lưu nó xuống đâu đó.**
>
> 1. **`mainKeyword` không phải định danh.** Nó là **kết quả đo**, và đổi mỗi
>    lần chạy lại keyword research — vòng 2026-09-07 đổi **233/582 market**.
>    Bất cứ thứ gì bạn khoá theo chuỗi này (ngoại lệ, mapping, cụm đã lưu) sẽ
>    **âm thầm trỏ sai** sau lần chạy tiếp theo: không lỗi, không cảnh báo,
>    chỉ là gom nhóm khác đi. Đã xảy ra thật — một ngoại lệ khoá theo chuỗi
>    làm **48 zip NYC gộp thành một cụm** và không khâu nào kêu. Dùng
>    `keywordMeasuredAt` để biết cần tính lại (§3.5).
> 2. **Từ khoá hiệu lực là `countyKeyword ?? mainKeyword`**, không phải
>    `mainKeyword` trần. Với các borough NYC, `countyKeyword` mới là thứ trang
>    thật sự nhắm — công thức ở §3.6. Group bằng `mainKeyword` trần cho ra số
>    cụm khác với thực tế.
>
> Nói cách khác: công thức ở trên trả lời "hiện giờ những zip nào tranh nhau
> một truy vấn", **không** trả lời "cụm này có còn là cụm tôi đã dựng trang
> không". Câu thứ hai phải hỏi lại mỗi vòng research.

```js
// B1: lọc buildable (cần 1 request chi tiết / zip — cache lại)
const buildable = [];
for (const m of markets) {
  if (!m.countyFips) continue;            // chưa có Location => chắc chắn không có gov data
  const d = await fetchDetail(m.zip);      // /markets/{zip}
  if (d.governmentData.length > 0) buildable.push({ ...m, detail: d });
}

// B2: group CHỈ trên buildable
const clusters = new Map();
for (const m of buildable) {
  const key = `${m.mainKeyword}::${m.countyFips}`;
  if (!clusters.has(key)) clusters.set(key, []);
  clusters.get(key).push(m.zip);
}
// cụm có length > 1 => bắt buộc phải có lớp AI mới được publish
```

> **Hai trạng thái rỗng khác nhau, đừng gộp**: "không có keyword volume"
> (API trả `404`) và "có keyword nhưng `governmentData: []`" là hai nguyên
> nhân hoàn toàn khác nhau — 175 vs 252 zip. Gộp chung thành một bộ đếm sẽ
> cho nhãn sai khi chẩn đoán.

**Chiến lược đề xuất:**

1. **49 zip độc lập** — dựng trước, lớp deterministic là đủ khác biệt.
2. **106 zip trong cụm** — **bắt buộc** sinh lớp AI trước khi publish. Ưu
   tiên cụm lớn nhất (Brooklyn 23 zip, Chicago 14 zip) vì rủi ro cao nhất.
3. Trong một cụm, lớp AI phải bám vào thứ **thật sự khác nhau giữa các
   zip** — dữ liệu cấp ZIP của Census: `census_median_home_value_usd`,
   `census_median_household_income_usd`, `census_median_year_built`,
   `census_homeownership_rate_pct`. Đừng để AI diễn giải lại số liệu cấp
   hạt (vốn giống nhau) bằng câu chữ khác nhau — đó là làm loãng nội dung
   trùng chứ không tạo giá trị thật.
4. Cân nhắc **không dựng cả cụm**: 23 trang cho 23 zip Brooklyn cùng phục
   vụ một từ khoá có thể thua một trang Brooklyn tốt. Số zip nhiều không
   đồng nghĩa nên có nhiều trang.

---

## 3.5 ⚠️ Trường nào BỀN, trường nào ĐỔI ĐƯỢC

Phân biệt này quan trọng vì một sự cố thật (2026-09-07): site khoá một
ngoại lệ theo chuỗi `mainKeyword`. Head Quarter chạy lại keyword research,
chuỗi đổi từ `"moving services new york"` thành `"moving companies new
york"`, và ngoại lệ **vỡ im lặng** — 48 zip NYC gộp thành một cụm duy nhất,
không component nào báo lỗi. Chỉ phát hiện được khi có người nhìn output.

Nguyên nhân gốc là tài liệu này: nó mô tả `mainKeyword` như thể là một
định danh. Không phải.

**BỀN — khoá ngoại lệ, cấu hình, mapping vào đây:**

| Trường | Vì sao bền |
|---|---|
| `zip` | Định danh thật của địa điểm |
| `vertical` | Do người đặt, không do pipeline sinh |
| `countyFips` | Mã liên bang; chỉ đổi khi bang tái tổ chức hành chính (đã xảy ra: Connecticut) |
| `(vertical, zip)` | Khoá của `MarketIdentity`, ổn định qua mọi lần chạy lại |
| `adapterKey` | Do người đặt trong `seed-datasources.ts` |
| `metric` (trong `governmentData`) | Do adapter đặt, đổi là schema drift chứ không phải thay đổi thường lệ |

**ĐỔI ĐƯỢC — không bao giờ khoá vào đây:**

| Trường | Khi nào đổi |
|---|---|
| `mainKeyword` | **Mỗi lần chạy lại keyword research.** Vòng 2026-09-07 đổi 233/582 market. Dùng `keywordMeasuredAt` để phát hiện — xem dưới |
| `searchVolume`, `cpc`, `keywordDifficulty` | Mỗi lần đo lại |
| `score`, `scoreVersion` | Mỗi lần chấm điểm lại |
| `semanticKeywords` | Mỗi lần fetch lại |
| `value` trong `governmentData` | Mỗi lần thu thập lại |
| `county` | Có thể từ `null` thành có tên khi nguồn được vá |

Quy tắc: **bất cứ thứ gì pipeline đo hoặc sinh ra đều đổi được.** Nếu cần
một khoá bền để gắn quyết định biên tập, dùng `zip` hoặc `countyFips`.

### `keywordMeasuredAt` — phát hiện từ khoá đã đổi

Cả hai endpoint đều trả `keywordMeasuredAt` (ISO timestamp, có thể `null`
nếu market chưa có dữ liệu từ khoá): thời điểm `mainKeyword` được đo gần
nhất.

Lưu lại giá trị này ở lần đồng bộ trước; lần sau thấy nó mới hơn nghĩa là
**từ khoá có thể đã đổi** — kể cả khi chuỗi trông vẫn như cũ (volume/KD có
thể đổi mà chuỗi không đổi). Nhờ vậy không cần giữ bản sao từ khoá cũ chỉ
để so.

Nó **không** thay thế được việc so tập URL trước/sau khi rebuild: từ khoá
đổi có thể tách hoặc gộp cụm, tức thêm/bớt trang. Timestamp cho biết "cần
kiểm lại", so tập URL cho biết "URL nào biến mất và cần redirect".

### Head Quarter PHẢI báo gì — và không cần báo gì

Ranh giới này rút ra từ một vòng rà chung giữa hai session (2026-09-07), và nó
gọn hơn ta tưởng lúc đầu. Chia theo đúng một câu hỏi: **site có tự suy ra được
từ dữ liệu không?**

**Không cần báo** — site tự thấy, vì nó đọc qua chính hàm dựng fact:

- thu thêm dữ liệu, chạy lại nguồn, đổi cách gán nguồn cho từng nghề
- số liệu đổi giá trị → `factsFingerprint` đổi
- đoạn văn đổi vì bất kỳ lý do gì → `textFingerprint` đổi
- một market mất/được thêm một nguồn → số của site tự đổi theo

**Phải báo** — không tín hiệu nào phủ được, site không thể suy ra:

| Thay đổi | Vì sao không tự thấy được |
|---|---|
| Thêm / bỏ trường trong response | Trường thiếu trông như dữ liệu rỗng (§3.5) |
| Đổi **ngữ nghĩa** một trường, giá trị giữ nguyên hình dạng | `resolvedAtResolution` đổi nghĩa mà kiểu vẫn là chuỗi — không gì kêu |
| Đổi cách sinh nội dung mà số liệu KHÔNG đổi | Đây là ca đã xảy ra thật; `textFingerprint` sinh ra chính vì nó |
| Đổi cách gom cụm / công thức từ khoá hiệu lực | Site khoá trang theo cụm; đổi cụm là thêm/bớt URL (§3.4) |
| Đổi ngưỡng validator, khiến văn cũ không còn đạt | Văn đã lưu vẫn render bình thường |

Nguyên tắc: **thay đổi DỮ LIỆU thì im lặng được, thay đổi HỢP ĐỒNG thì không.**
Dữ liệu chảy qua các đường đã có tín hiệu; hợp đồng thì không có tín hiệu nào,
vì tín hiệu tự nó là một phần của hợp đồng.

### ⚠️ Khi Head Quarter thêm trường mới: coi là optional trong ít nhất một chu kỳ deploy

Thêm một trường vào response là thay đổi **tương thích ngược ở phía API** —
nhưng **không** tương thích ngược với consumer nào cache response.

Ca thật (2026-09-07, khi thêm `keywordMeasuredAt`): site khai báo trường
mới là bắt buộc trong schema validation, và `next build` ném lỗi validation
hàng loạt — trong khi script của chính nó parse cả 582 response sống không
lỗi cái nào. Cùng schema, cùng API, cùng máy.

Nguyên nhân: Next.js `use cache` lưu **response HTTP** xuống `.next/cache`
và giữ qua các lần build. Build đang validate body ghi từ trước khi trường
tồn tại. Mọi bằng chứng đều chỉ sai hướng — `curl` có trường, script có
trường, chỉ build là không.

**Khuyến nghị**: trường mới thêm sau khi site đã chạy nên nhận cả "vắng
mặt" lẫn `null`, chuẩn hoá về `null`. Trường thuộc hợp đồng gốc thì giữ
strict — một trường luôn có mà biến mất là regression thật, phải fail to.

Các trường thêm sau, tính tới hôm nay: `county`, `countyFips` (2026-09-06),
`keywordMeasuredAt`, `lat`, `lon`, `metro`, `cbsaCode` (2026-09-07).

### ⚠️⚠️ Bẫy im lặng hơn: dữ liệu mới KHÔNG lên trang, mà không có lỗi nào

Nguy hiểm hơn bẫy schema ở trên, vì bẫy schema ít nhất còn ném lỗi
validation. Cái này **build xanh, trang render bình thường, chỉ thiếu dữ
liệu**.

Ca thật (2026-09-07, khi B07003 về): site chạy đồng bộ manifest — cập nhật
đúng, 256/256 market — rồi build. Trang render ra **không có dữ liệu mới**.
Không lỗi, không cảnh báo.

Nguyên nhân dây chuyền:
1. Hàm đọc manifest được bọc trong cache build với thời hạn tối đa
2. Cache tồn tại qua các lần build → build đọc **manifest cũ**
3. Dữ liệu trang bị khoá theo `manifest.generatedAt` → manifest cũ phát ra
   version cũ → **toàn bộ dataset cũng trả từ cache**

Một lỗi kéo theo lỗi kia, và không khâu nào báo gì.

**Triệu chứng nhận biết**: script/CLI thấy dữ liệu mới, **trang đã build thì
không**. Nếu thấy đúng cặp triệu chứng này, nghi cache build trước khi nghi
API.

**Nguyên tắc**: file do chính pipeline build của bạn sinh ra là **build
input**, không phải dữ liệu remote — đọc ở module scope, đừng bọc trong
cache dành cho dữ liệu mạng. Và verify bằng đúng điều kiện sinh ra lỗi:
regenerate rồi build mà **không** xoá thư mục cache.

### ⚠️⚠️⚠️ Bẫy cùng loại nhưng nằm ở tầng thấp hơn: cache `fetch()` không ai địa chỉ hoá được

Ca thật (2026-09-07). Sau khi Head Quarter sinh lại 2 đoạn văn, site build lại
để lấy bản mới. Kết quả **trong cùng một lần build, cùng một lệnh**:

```
85142 → text CŨ
90280 → text MỚI
```

Site không hề cache trên đĩa. Nhưng Next giữ một cache **thứ hai** cho
`fetch()`, khoá theo URL, nằm trong `.next/cache`, tồn tại qua các lần build và
**không mang tag** — nên `revalidateTag` không với tới, và đổi khoá của lớp
`use cache` bọc bên ngoài cũng không đụng được. Khác biệt giữa hai zip chỉ là
entry nào tình cờ hết hạn: **tung đồng xu**, và trang giữ text cũ trông y hệt
trang đúng.

Cùng cơ chế đó trước đây đã gây ra hai sự cố mà site chẩn đoán sai tầng — lỗi
ZodError khi thêm trường, và 5 metric mobility không lên trang. Cả hai lần đều
báo "đã sửa"; bản vá đúng nhưng không phải nguyên nhân duy nhất.

> **Nguyên tắc**: một cache mà không có gì địa chỉ hoá được thì không phải
> cache, nó là **state không ai kiểm soát**. Có tag mới là cache.

**Head Quarter nay chặn từ gốc.** Mọi response `/api/v1` — kể cả 401, 404, 422,
429 — đều trả:

```
Cache-Control: no-store, no-cache, must-revalidate
Pragma: no-cache
```

Không gửi header cache **không** có nghĩa "đừng cache"; nó có nghĩa mỗi client
tự chọn chính sách, và mặc định của framework hiếm khi là cái bạn muốn. Việc
sinh nội dung đã được cache sẵn phía server (trong `AiGeneration`), nên một
request chỉ là một lượt đọc database — cache HTTP không mua được gì, chỉ mua
thêm một khoảng thời gian site phục vụ nội dung đã bị thay thế.

Site **vẫn nên cache**, nhưng bằng lớp của chính mình, có tag, invalidate được.
Điều bị chặn là việc tầng transport tự cache thay bạn.

Lý do 401 cũng `no-store`: một 401 bị cache sống lâu hơn cái key đã xoay vòng
gây ra nó.

### `textFingerprint` — tín hiệu đúng để phát hiện đoạn văn đã cũ

`factsFingerprint` trả lời câu hỏi **hẹp hơn** bạn tưởng: nó đổi khi **con số**
đổi. Nó **không** nhúc nhích khi cùng bộ số được diễn đạt lại — mà đó chính là
điều xảy ra khi một luật prompt siết lại và toàn bộ nội dung được sinh lại.
Đã xảy ra thật hai lần trong dự án này.

Nên `/interpretation` trả thêm:

```json
{ "factsFingerprint": "1088e6b6…", "textFingerprint": "d4da3328e0ac5596" }
```

`textFingerprint` đổi **khi và chỉ khi** đoạn văn bạn render đổi, bất kể vì lý
do gì. Muốn hỏi "bản tôi lưu có còn là bản sẽ được phục vụ không" thì so
trường này. Dùng `factsFingerprint` cho câu hỏi khác: "số đã đổi chưa".

### Khi thêm trường mới, LUÔN báo kèm độ phủ

Một trường rỗng không chỉ tạo code chết — nó tạo **báo cáo sai**.

Ca thật: site xin `metro`/`cbsaCode` để sửa liên kết nội bộ. Hai cột đó có
trong schema nhưng **chưa bao giờ được ghi (0/300)**. Nếu Head Quarter cứ
phơi ra, site đã không phát hiện được: nhánh fallback "cùng bang" vốn tồn
tại sẵn nên trang vẫn chạy — chỉ là chạy 100% nhánh sai, trong khi site
tưởng đã sửa xong và sẽ **báo cáo "đã dùng CBSA" mà thực tế không dùng gì**.

Nên độ phủ được báo cùng lúc với trường, và con số `0/300` có giá trị đúng
bằng chính trường đó. Độ phủ hiện tại: `lat`/`lon` **256/256 buildable**,
`county` **255/256** (chỉ 06902 CT thiếu), `countyFips` **256/256**.

---

## 3.6 `countyKeyword` — khi từ khoá cấp thành phố quá rộng

`mainKeyword` được sinh từ tên Census "Place", và một Place có thể rộng hơn
nhiều so với thứ người ta thật sự tìm. Ví dụ rõ nhất: cả **48 zip NYC** đều
mang Place `"New York"`, nên mọi borough đều thừa hưởng cụm từ khó nhất
trong niche, trong khi từng borough có từ khoá riêng dễ hơn hẳn (đo
2026-09-07):

| borough | từ khoá riêng | SV | KD | (so với từ khoá thành phố) |
|---|---|---|---|---|
| brooklyn | movers brooklyn | 6.600 | **6** | KD 29 |
| queens | moving services queens | 2.400 | **2** | KD 29 |
| bronx | moving services bronx | 1.300 | **0** | KD 29 |
| manhattan | moving companies manhattan | 1.000 | **15** | KD 29 |
| staten island | movers staten island | 880 | **0** | KD 29 |

```json
"countyKeyword": {
  "keyword": "movers brooklyn",
  "searchPlace": "brooklyn",
  "searchVolume": 6600, "cpc": 37.25, "keywordDifficulty": 6,
  "measuredAt": "2026-09-07T..."
}
```

- **`null` với hầu hết zip.** Phần lớn county không có tên tìm kiếm riêng —
  đã đo và xác nhận `"movers cook county"`, `"movers harris county"` đều
  **không có dữ liệu**. Bịa một cái tên là bịa địa danh.
- Khoá theo `countyFips`, **không** theo chuỗi từ khoá — nên nó không vỡ khi
  Head Quarter chạy lại research (§3.5).

### ⚠️ Nó KHÔNG thay thế `mainKeyword`

Đây là trường riêng, không phải bản ghi đè. Một consumer từng gom cụm theo
`mainKeyword` mà chỉ bỏ ngoại lệ NYC đi thì **48 zip gộp thành một trang** —
vì `mainKeyword` của cả 48 vẫn giống nhau.

Cách xử lý đúng: dùng **từ khoá hiệu dụng** làm khoá gom cụm:

```js
const effectiveKeyword = market.countyKeyword?.keyword ?? market.mainKeyword;
```

Khi đó các borough tách ra theo **quy tắc thường**, và mọi ngoại lệ viết
tay để giữ chúng tách nhau trở nên thừa thật — xoá được, chứ không phải
biện minh thêm lần nữa.

### Bài học đo lường kèm theo

Staten Island ban đầu bị báo là **10 SV** ("quá nhỏ, bỏ qua"). Con số đó
đến từ **một** cách viết duy nhất. Đo đủ các cách viết:
`movers staten island` = **880 SV, KD 0** — một thị trường thật.

> **Một thị trường trông như không có cầu thường chỉ là thị trường mới được
> đo bằng một cách viết.** Trước khi kết luận một địa bàn hay một niche
> không có nhu cầu, kiểm xem đã thử bao nhiêu cách diễn đạt.

---

## 3.7 `/interpretation` — lớp diễn giải AI, tập trung ở Head Quarter

```
GET /api/v1/niches/{vertical}/markets/{zip}/interpretation
```

Trả về 3–5 câu văn xuôi mô tả thị trường đó, **chỉ dùng số đã đo**.

```json
{
  "text": "In ZIP 80013, 12.9% of residents lived somewhere else a year earlier…",
  "cached": true,
  "factsFingerprint": "56f07843c091fea6b6dd9cc37cc4853f"
}
```

### Đã sinh sẵn những zip nào (moving-services, 2026-09-07)

**127/127 zip standalone đã có text đạt và nằm sẵn trong cache.** Site gọi
endpoint sẽ nhận `"cached": true` ngay, không tốn phí, không chờ.

129 zip còn lại **nằm chung trang cụm và cố ý KHÔNG sinh**. Không phải để tiết
kiệm: text này viết về **một** zip, nên đặt nó lên trang gộp nhiều zip là trình
bày mô tả của một thành viên như thể mô tả cả cụm — đúng loại "khung sai" mà
validator sinh ra để chặn, chỉ khác là ở cấp trang thay vì cấp câu. Nếu site cần
đoạn văn cho **trang cụm**, đó phải là endpoint khác với đầu vào là cả cụm, chứ
đừng gọi endpoint này cho một zip đại diện.

**Vì sao không để mỗi site tự gọi Anthropic:** không phải để tiết kiệm key, mà
vì mỗi site tự viết validator nghĩa là N bản kiểm tra chống bịa số, và chúng
**sẽ trôi khỏi nhau**. Một site đã publish hụt câu *"roughly one resident in
five"* ngay cạnh con số 29,5% đã đo — ở đúng lớp mà site tin là không thể bịa số.

| Mã | Nghĩa | Xử lý |
|---|---|---|
| `404` | Zip không có dữ liệu từ khoá | Bỏ qua |
| `422` | Sinh ra nhưng **không đạt validation** | **Đừng retry** — thử lại thường ra y hệt. Báo Head Quarter kèm `issues` |
| `429` | Chạm trần chi tiêu | Dừng batch |
| `503` | Chưa cấu hình `ANTHROPIC_API_KEY` | Lỗi cấu hình |

`422` là **cơ chế hoạt động đúng**, không phải sự cố: model bịa số và hệ thống
đã chặn trước khi trả về. Text chỉ được trả khi đã qua kiểm.

### Validator kiểm gì — và KHÔNG kiểm gì

Kiểm: mọi số phải khớp dữ liệu đo · chỉ số cấp county/state không được gán cho
zip · không dùng tỷ lệ viết bằng chữ · không đặt tên hạt khi dataset không có tên.

**Không** kiểm được: **lỗi đảo chiều** ("gained 11,517" khi thực tế là mất) —
validator so theo độ lớn, không thấy dấu. Đó là lỗi ngữ nghĩa; ràng buộc nằm ở
prompt. Nếu site giữ một lớp kiểm riêng, đây là chỗ đáng đặt nó.

### Ranh giới trách nhiệm

```
Head Quarter: "câu này có ĐÚNG không"       — số, phạm vi, tên địa danh
Site:         "câu này có THUỘC VỀ ĐÂY không" — đúng ngành, ngữ nghĩa nội bộ site
```

Head Quarter phục vụ 13 niche nên không biết "plumbing" là lệch ngành với một
site chuyển nhà, cũng không biết zip nào nằm trong cụm nào của site.

### Ba bài học từ đợt xây (2026-09-07)

**Prompt dùng chung cho mọi ngành thì không đúng ngành nào.** Bản đầu sinh ra
nội dung nói về *plumbing, wiring, roofing, warranty* trên trang **chuyển nhà** —
46% số text. Không câu nào sai, chỉ là sai nghề. Độ lệch đến **từ dữ liệu**: năm
xây nhà thật sự hàm ý điều gì đó về hệ thống toà nhà, chỉ là đó không phải việc
của người khiêng đồ. Prompt giờ có mô tả từng ngành, và **danh sách cấm** là phần
chịu lực.

**Dữ liệu nội bộ không được lọt vào nội dung cho người đọc.** Search volume từng
nằm trong tập fact, và 83% số text đem nó ra khuyên người đọc. Tệ hơn: model suy
*"2.400 lượt tìm → nhiều nhà cung cấp cạnh tranh"* — suy từ **cầu** ra **cung**.
Đã bỏ hẳn khỏi tập fact.

**Không dataset nào ở đây đo phía cung.** Tất cả đo cầu, dân số hoặc nhà ở. Nên
mọi kết luận về độ sẵn có, mức cạnh tranh, áp lực đặt lịch đều **không có nguồn
theo cấu trúc**. Lời khuyên thực dụng vẫn được phép — nhưng phải đứng thành câu
riêng, không được trình bày như **hệ quả của một con số**, vì khi đó nó đội lốt
phát hiện từ dữ liệu.

**Cấm một cấu trúc thì phải cấm ở mọi con số, không chỉ ở con số từng gây lỗi.**
Luật cấm nối "số → nhận định về nhà cung cấp" ban đầu chỉ ghi cho **số di cư cấp
county**. Model tuân thủ đúng chữ: nó chuyển sang treo cùng cấu trúc đó lên **số
mobility cấp ZIP** — *"…1.987 từ nước ngoài — nên movers ở đây làm đủ loại từ
chuyển trong phố tới hàng quốc tế"*. **44/151 text (29%)** dính, và **validator
cho qua toàn bộ**, vì mọi con số trong câu đều thật. Luật giờ áp cho *mọi* con số.

**Đợt sinh đầu bị chặn ~13% vì lỗi của chính Head Quarter, không phải model.**
Prompt làm tròn phần trăm về 1 chữ số thập phân; với giá trị dưới 10 thì mức làm
tròn đó lệch **0,51%**, vừa quá ngưỡng 0,5% của validator. Prompt đưa `7.9%`,
model trích đúng nguyên văn, validator chặn chính chỉ thị của mình — mỗi zip tốn
2 lượt gọi trước khi hỏng. Đã sửa ở **độ chính xác hiển thị** (chọn số thập phân
theo độ lớn), *không* nới ngưỡng: nới ngưỡng cũng sẽ cho lọt số thật sự sai. Sau
khi sửa: **0/37 bị chặn**.

> Bài học chung: **validator xanh không có nghĩa nội dung đúng.** Validator chỉ
> biết những luật đã viết. Cả năm vấn đề trên đều qua được validator. Khi thêm
> nội dung sinh tự động, phải **quét cả tập** chứ không chỉ đọc vài mẫu.
>
**Cấm theo một từ định lượng cũng là cấm quá hẹp.** Luật quét bắt `many jobs
involve` đi thẳng qua `some jobs involve rental units` — cùng khẳng định về khối
lượng việc, khác đúng một tính từ. Sau khi nới sang mọi từ định lượng, **2 text
moving-services trước đó tôi báo "sạch" hoá ra vẫn vi phạm** (85142, 90280). Con
số 0 khi ấy là sai; đã sinh lại.

**Luật quét phải theo từng nghề, không dùng chung.** Bản đầu của
`scan-generated-copy.ts` hard-code danh sách lạc nghề của moving-services, nên
chạy cho `roofing-replacement` thì chính chữ "roofing" bị gắn cờ — văn đúng báo
100% lạc nghề. Nay lạc-nghề được **suy ra**: của nghề V = từ vựng của mọi nghề
KHÁC V, nên từ của một nghề không thể lạc nghề với chính nó. Hai ngoại lệ phải
khai tay vì suy diễn không biết được: nghề dùng chung từ hợp pháp (thợ điện mặt
trời **phải** nói về mái nhà), và từ chỉ cấm ở một nghề ("bảo hành" chính đáng
với thợ lợp, nhưng bên chuyển nhà không bảo hành nhà bạn).

> Và bộ quét cũng phải **tự chứng minh là nó bắt được**: lần chạy đầu báo "0 lỗi"
> trên 123 text — không phân biệt được là prompt đã sạch hay regex đã chết. Nay
> `scripts/scan-generated-copy.ts` chạy 9 câu lỗi đã biết + 3 câu đúng đã biết
> qua chính bộ regex đó **trước khi** in kết quả, và thoát lỗi nếu trượt.

---

## 4. Nguồn dữ liệu chính phủ hiện có

Mỗi nguồn được gắn nhãn niche (`relevantVerticals`) để biết dùng cho việc gì.

| `adapterKey` | Dữ liệu | Độ phân giải | Niche |
|---|---|---|---|
| `census_acs_housing` | Giá nhà trung vị, thu nhập hộ gia đình, năm xây trung vị, tỷ lệ sở hữu nhà | ZIP | roofing, hvac, water-damage, **moving** |
| `irs_migration` | Số hộ chuyển đến/đi/ròng, tổng thu nhập chuyển đến | COUNTY (suy diễn) | **moving** |
| `fema_disaster_declarations` | Số lần công bố thảm hoạ liên bang 10 năm | COUNTY (suy diễn) | roofing, water-damage |
| `nrel_pvwatts` | Sản lượng điện mặt trời, bức xạ, hệ số công suất | ZIP | solar |
| `noaa_climate_normals` | Degree-days sưởi/làm mát, lượng mưa | ZIP | hvac, roofing, water-damage |
| `eia_electricity` | Giá điện dân dụng | STATE (suy diễn) | solar |

> `noaa_climate_normals` và `eia_electricity` đã code xong nhưng **chưa
> chạy thật** (chưa có API token). Nếu `governmentData` chưa thấy 2 nguồn
> này thì đó là lý do.

### Riêng cho niche `moving-services`

Đây là niche đang được ưu tiên. Dữ liệu mạnh nhất để tạo khác biệt:

- `irs_migration_inflow_households` / `outflow` / `net` — **dòng người
  chuyển đến/đi thật**. Đây là câu chuyện chính của trang: "hạt này mỗi năm
  có X hộ chuyển đến, Y hộ chuyển đi".
- `census_median_home_value_usd`, `census_median_household_income_usd` —
  bối cảnh kinh tế, ảnh hưởng trực tiếp tới mức chi cho dịch vụ chuyển nhà.
- Lưu ý dữ liệu thật: Puerto Rico gần như không có trong dữ liệu IRS;
  Connecticut đã đổi mã hạt sang "Planning Region" nên một số zip CT không
  khớp được. Đây là hạn chế thật của dữ liệu nguồn, không phải bug.

---

## 5. Kết nối website vào `/publisher`

Sau khi website chạy thật, quay lại Control Panel → **Publisher** →
"Kết nối website mới". Cần 4 thông tin:

| Ô | Giá trị | Lấy ở đâu |
|---|---|---|
| Tên website | Tuỳ ý | — |
| URL | `https://atmovingservices.com` | — |
| GSC property | `sc-domain:atmovingservices.com` | Search Console, **phải verify trước** |
| GA4 property ID | Dạng số, vd `123456789` | GA4 → Admin → Property Settings. **Không phải** mã `G-XXXXXXX` |
| WP REST API base | Tuỳ chọn | Chỉ điền nếu `/wp-json` không nằm ở URL chính |

### Bắt buộc: cấp quyền cho Service Account

Control Panel dùng **một** Google Cloud Service Account chung cho mọi
website (không OAuth từng site, không token hết hạn).

Việc bạn phải làm cho mỗi website:
1. Control Panel → Cài đặt → Publisher → dán nội dung file JSON key (nếu
   chưa có).
2. Lấy `client_email` trong file JSON đó.
3. Thêm email này làm **viewer** trong Search Console của website.
4. Thêm email này làm **viewer** trong GA4 property của website.

Thiếu bước 3/4 → `/publisher` sẽ báo lỗi ở đúng phần đó (GSC hoặc GA4 báo
riêng, không làm hỏng cả trang).

### Head Quarter đọc gì từ website

Tất cả đều **đọc live mỗi lần tải trang**, không lưu bản sao — nên số liệu
không bao giờ cũ so với nguồn thật:

- **WordPress REST API**: số bài đã publish
- **Search Console**: clicks, impressions, vị trí trung bình, top pages
- **GA4**: active users, sessions, pageviews, traffic theo kênh

"Tỷ lệ index" trên Publisher là **ước tính** (số trang có impression / tổng
số bài), vì Google không cho truy vấn hàng loạt Index Coverage. Muốn biết
chính xác một URL đã index chưa thì dùng chức năng kiểm tra từng URL trong
trang chi tiết.

---

## 6. Thứ tự triển khai

1. Mua domain → thêm vào Control Panel `/domains` (tự tạo zone Cloudflare)
2. Trỏ nameserver tại registrar sang Cloudflare → bấm "Kiểm tra lại" đến
   khi trạng thái `active`
3. Dựng WordPress headless + Next.js frontend
4. Verify domain trong Search Console; tạo GA4 property
5. Cấp quyền viewer cho service account (mục 5)
6. Lấy API key ở Cài đặt → gọi thử `/api/v1/niches` để chắc chắn kết nối được
7. Dựng trang từ dataset (ưu tiên zip có `governmentData` và `score` cao)
8. Kết nối website vào `/publisher`

---

## 7. Nguyên tắc bắt buộc về dữ liệu

Đây là những quy tắc Control Panel tự tuân thủ; website cũng phải theo,
nếu không sẽ phá vỡ tính trung thực của toàn hệ thống:

1. **Không bịa số.** Chỉ hiển thị số có trong `governmentData` hoặc
   `mainKeyword`/`nationalBaseline`. Không nội suy, không "ước lượng cho
   đẹp".
2. **Tôn trọng `isInferred`.** Số liệu cấp hạt phải nói là cấp hạt.
3. **Không dùng dữ liệu giả để lấp chỗ trống.** Zip không có dữ liệu thì
   đừng dựng trang cho zip đó, đừng thay bằng số trung bình.
4. **Ghi nguồn.** `sourceName` + `fetchedAt` nên xuất hiện trên trang.
5. **`keywordDifficulty: 0` là dữ liệu thật**, không phải null.
6. **`score` và `governmentData` có thể vắng mặt** — code phải chịu được.
7. **Không đoán tên hạt.** `county === null` thì viết "hạt chứa ZIP xxxxx",
   không suy tên từ mã FIPS.
8. **Không publish trang trong cụm trùng lặp nếu chưa có lớp AI** (§3.4).
9. **Tập dữ liệu mở rộng cũng là thay đổi cần verify, không phải cải thiện
   đơn thuần.** Trực giác mặc định của cả hai phía đều là "thêm dữ liệu thì
   an toàn hơn" — sai. Ca thật: vòng sửa từ khoá 2026-09-07 đưa buildable
   từ 155 lên 256, và **zip mới vào tập** (06902 Stamford CT) lại chính là
   zip duy nhất thiếu `irs_migration` **và** có `county: null`. Nếu code chỉ
   xử lý những hình dạng dữ liệu từng quan sát được, chính lần mở rộng đó sẽ
   sinh ra trang bịa tên hạt hoặc bịa số. Mở rộng tập dữ liệu phải chạy lại
   toàn bộ guardrail như khi thu hẹp.

   **Và phải chạy trên TOÀN TẬP, không chỉ trên phần thay đổi.** Tối ưu
   thành "chỉ verify delta" sẽ làm quy tắc này vỡ trong im lặng: 06902 lọt
   qua được không phải vì nó *thay đổi*, mà vì nó *mới xuất hiện* trong khi
   mọi thứ khác vẫn nguyên — một check chỉ nhìn phần khác biệt sẽ không
   thấy hình dạng dữ liệu mới mà nó mang theo.

---

## 8. Câu lệnh kiểm tra nhanh

```bash
curl -s -H "Authorization: Bearer <API_KEY>" \
  "http://localhost:3000/api/v1/niches" | python3 -m json.tool
```

```bash
curl -s -H "Authorization: Bearer <API_KEY>" \
  "http://localhost:3000/api/v1/niches/moving-services/markets/10002" | python3 -m json.tool
```
