# Hướng dẫn dựng website kết nối vào Head Quarter (pSEO Control Panel)

> **Tài liệu bàn giao.** Đưa file này cho session Claude Code đang dựng
> website thật. Nó mô tả *hợp đồng* giữa website và Control Panel
> ("Head Quarter"): website lấy dữ liệu ở đâu, dữ liệu có hình dạng gì,
> Head Quarter cần gì ngược lại từ website.
>
> Mọi ví dụ response trong tài liệu này đều **chụp từ API thật đang chạy**
> (2026-09-06), không phải shape tự nghĩ ra.

> **Đọc kèm hai tài liệu nữa — chúng không lặp lại nội dung ở đây.**
> File này là *hợp đồng dữ liệu*: lấy gì, hình dạng ra sao. Hai file kia là
> *những gì đã sai khi dựng site đầu tiên*, đo trên site thật chứ không suy
> luận. Bỏ qua chúng nghĩa là phát hiện lại từ đầu:
>
> | File | Trả lời câu hỏi | Vì sao cần trước khi viết code |
> |---|---|---|
> | `docs/TECHNICAL_SEO_QC.md` | sitemap, canonical, redirect, cấu trúc URL, JSON-LD; §5 là checklist publisher tự giữ, §8 là quy trình worktree + PR | Viết ra để publisher mới **kế thừa** — dòng đầu file nói đúng vậy. Nhiều mục là thứ sửa được trong 5 phút lúc dựng, và tốn một đợt re-crawl nếu phát hiện sau. |
> | `docs/CONTENT_QC.md` | luật nội dung, và **cách chứng minh** đã tuân thủ | Crawl toàn bộ 192 URL, không lấy mẫu. Phát hiện chính: **368 câu vi phạm `no-supply-side-bridge`, không câu nào do AI viết** — tất cả nằm trong text template mà không check nội dung nào từng soi tới. |
>
> Dòng cuối bảng là bài học đắt nhất của cả ba tài liệu: lớp deterministic
> không được miễn kiểm chỉ vì con người viết ra nó.

**Bản 7 — 2026-09-13**:
> - **§3.7c mới**: endpoint đoạn cấp cụm `/cluster-interpretation`. Trước đó
>   tài liệu không nhắc nó lần nào, và bỏ sót nó **không gây lỗi** — trang
>   cụm vẫn build, chỉ là không có chữ AI. Đo trên site đầu: 161 ZIP có
>   đoạn, **127 hiện ra, 34 nằm im**.
> - Trỏ sang hai tài liệu QC ở trên; trước đây không tài liệu nào trỏ sang
>   tài liệu nào.

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

Base URL (production, từ 2026-09-07):

```
https://hq.cornships.com/api/v1
```

TLS Let's Encrypt, tự gia hạn. HTTP tự chuyển 301 sang HTTPS.

> **`/api/v1` KHÔNG bị Basic Auth.** Giao diện UI của Control Panel nằm sau
> Basic Auth ở Nginx, nhưng `location /api/v1/` có `auth_basic off` — site gọi
> bằng `X-Api-Key` như cũ, không cần thêm gì. Nếu một ngày bạn nhận `401` mà
> thân phản hồi là **HTML** thay vì JSON, đó là Basic Auth của Nginx chứ không
> phải lớp xác thực của app: báo ngay, đó là lỗi cấu hình hạ tầng.

Trước đó tài liệu ghi `http://<host-control-panel>:3000` — địa chỉ dev. Nếu site
còn trỏ vào đó thì phải đổi.

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

### 3.0 `GET /api/v1/version` — server đang chạy commit nào

```json
{ "commit": "66dc79539d0eb21a3960a5b7791456f10e942af1", "builtAt": "2026-09-07T15:15:40.225Z" }
```

Cả hai giá trị được **nướng vào lúc build**, nên chúng mô tả **bản đang được
phục vụ** — không phải thứ đang nằm trên đĩa, vốn có thể khác nếu một lần deploy
hỏng giữa chừng hoặc ai đó chạy `git` bằng tay.

Dùng để trả lời câu "bản mới đã lên chưa" mà không phải hỏi ai:

```bash
curl -s -H "x-api-key: $KEY" https://hq.cornships.com/api/v1/version
```

So `commit` với SHA bạn vừa push. Khớp là xong; không khớp nghĩa là deploy chưa
chạy hoặc đã hỏng — **"workflow xanh" và "tiến trình đang phục vụ commit đó" là
hai khẳng định khác nhau**, và trước đây chỉ khẳng định thứ nhất quan sát được
từ bên ngoài.

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

## 3.4 ⚠️ Cụm zip trùng lặp — đọc cả phần ĐÍNH CHÍNH cuối mục

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

> ### ⚠️ ĐÍNH CHÍNH 13/9/2026 — mục 2 và 3 ở trên ĐÃ LỖI THỜI
>
> Site đầu tiên (`atmovingservices.com`) chọn **mục 4**, và lựa chọn đó làm
> mục 2–3 không còn áp dụng. Đo trên site đang chạy:
>
> | | |
> |---|---|
> | Market trong manifest | 256 |
> | Trang riêng (`clusterSize <= 1`) | 127 |
> | Trang **cụm** (mỗi cụm một trang) | 31 |
> | **Tổng trang** | **158** |
>
> Một cụm = **một** trang, không phải một trang mỗi zip. Nên trong cụm
> **không có gì để phân biệt giữa các zip** — và `cluster-view.tsx` của site
> đó **không render lớp AI lấy một lần**.
>
> Hệ quả đã trả tiền mới biết: Head Quarter vẫn sinh lớp AI cho zip nằm
> trong cụm theo mục 2. Đo 13/9/2026: **161 zip có đoạn văn, 127 hiện trên
> trang, 34 KHÔNG trang nào hiện.** Khoảng $0.20 trong một lô sinh lại rơi
> vào nhóm này.
>
> **Nếu bạn dựng publisher mới:**
>
> - Chọn trước một trong hai hình dạng, và ghi lại lựa chọn đó ở repo site.
> - Chọn **một trang mỗi cụm** (khuyến nghị — nó xoá vấn đề trùng lặp thay
>   vì làm loãng nó): thì **đừng sinh lớp AI cho zip trong cụm**. Nếu muốn
>   trang cụm có đoạn diễn giải, nó phải là đoạn **cấp cụm**, viết về cả
>   Brooklyn — không phải đoạn của một zip thành viên.
> - Chọn **một trang mỗi zip**: mục 2–3 ở trên áp dụng nguyên vẹn.
>
> Kiểm bên HQ trước khi tiêu tiền:
>
> ```bash
> tsx scripts/interpretations-shown.ts   # zip nào có đoạn văn mà không trang nào hiện
> ```

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

### ⚠️ ĐỌC KHÔNG BAO GIỜ TỐN TIỀN — sinh phải xin bằng `?generate=1`

```
GET …/interpretation              → chỉ trả văn ĐÃ CÓ. Không bao giờ gọi model.
GET …/interpretation?generate=1   → cho phép sinh nếu chưa có. TỐN TIỀN.
```

Không có sẵn thì `404` kèm `"reason": "not_cached"`. Phân biệt rõ với `404` +
`"reason": "no_market_data"`: **hai loại vắng mặt này tự khỏi theo cách khác
nhau.** `not_cached` sẽ hết sau đợt sinh kế tiếp của Head Quarter; còn
`no_market_data` nghĩa là zip đó **không nên có trang**. Gộp chúng thì cái thứ
hai trốn được trong cái thứ nhất, và một zip lẽ ra phải bị loại khỏi inventory
sẽ trông như đang chờ.

Mặc định này từng ngược lại, và một ngày là đủ để thấy vì sao nó sai. Một
session dò đúng **một** zip để chạy thử một nhánh test đã mua một bản sinh
$0,024 cho market cố ý không có văn. Thêm cờ `cachedOnly` vá được lời gọi đó —
rồi chính session ấy phát hiện rò rỉ **không phải một lần**: hai script thường
lệ của họ lặp qua cả 127 market qua endpoint này, nên mọi market Head Quarter
chưa viết văn sẽ được **consumer viết hộ, im lặng, theo lịch**.

> Một tham số phải nhớ bật thì không phải bảo vệ — nó là cái bẫy kèm sẵn cách
> lách. Nếu mọi consumer đều cần nó ở mọi lời gọi thì đó là **mặc định đang xin
> được đổi**.

**Ranh giới việc này chốt lại:** Head Quarter quyết **sinh gì** (bằng batch, có
chủ đích, đối chiếu trần chi tiêu nó nhìn thấy được). Site quyết **render gì**.
Chi phí thôi phụ thuộc vào việc ai bấm build lúc nào.

`?cachedOnly=1` vẫn được chấp nhận và giờ thừa — giữ để site đã dùng nó không gãy.

> Cùng luật cache như đường sinh: fingerprint phải khớp, và văn đã lưu được
> **kiểm lại lúc đọc** chứ không tin sẵn — nên một lần dò không bao giờ báo về
> đoạn văn mà luật hôm nay sẽ chặn.

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

### ⚠️⚠️ Đoạn theo ZIP cache theo NGÀNH, không theo site

Khoá cache là `(vertical, zip, factsFingerprint)`. Không có `websiteId`.

Hệ quả: **hai publisher cùng ngành nhận đúng từng chữ một cùng một đoạn
văn** cho cùng một ZIP. Không phải "tương tự" — giống hệt.

Điều này an toàn khi mỗi ngành có một publisher, và đó là tình trạng hôm
nay (`moving-services` có một site). Nó trở thành vấn đề đúng vào lúc bạn
dựng site thứ hai cho cùng ngành: 127 đoạn diễn giải sẽ trùng khớp tuyệt
đối giữa hai tên miền. Template khác nhau nên trang không giống hệt —
nhưng **đúng phần được viết ra để khác biệt thì lại giống**, và đó là phần
duy nhất Google không thể giải thích bằng "hai site cùng dùng một mẫu".

Cách rẻ nhất để tránh: **publisher mới ở ngành khác.** 13 ngành đã nghiên
cứu, và ngành mới không tốn gì thêm ở tầng cache.

Nếu bắt buộc phải có hai site cùng ngành, phải sửa ở HQ trước khi dựng —
thêm `websiteId` vào khoá cache và sinh lại toàn bộ cho site thứ hai
(~$7,40 cho 127 đoạn, đo trên `moving-services`). Đừng dựng trước rồi
tính sau: lúc đó hai site đã publish nội dung trùng nhau và Google đã
crawl.

> Thẻ "Ngân sách AI" trong `/publisher` nói khoản đoạn-theo-ZIP là thứ
> site thứ hai **không phải trả lại**. Đúng về tiền, và đó chính là cái
> bẫy: khoản tiết kiệm đó chỉ tồn tại vì hai site dùng chung một đoạn văn.

---

## 3.7b ⚠️ Ý định tìm kiếm phải ĐO, và đo theo TỪNG thị trường

Lớp diễn giải chạy 227 lần trước khi ai hỏi "nó viết cho ai". Câu trả lời
là: cho một người duy nhất, vì prompt không biết ý định tồn tại.

Đo 12/9/2026 trên chính văn bản đã sinh — tỷ lệ đoạn mang ngôn ngữ so sánh
báo giá:

| Nhóm ý định | n | "so sánh" |
|---|---|---|
| commercial | 142 | 94% |
| informational | 54 | 93% |
| navigational | 16 | 94% |
| transactional | 15 | **100%** |

Không biến thiên. Nhóm `commercial` đúng là **do tình cờ** — brief mặc định
vốn là giọng so sánh. Nhóm `transactional` lệch nặng nhất: người gõ `movers
pflugerville` để **đặt** dịch vụ nhận một trang bảo họ đi **so sánh**.

### Ý định lấy từ đâu

`dataforseo_labs/google/search_intent/live` — cùng nhà cung cấp đã dùng cho
volume, nhận tối đa 1000 từ khoá một lần. Chi phí đo được: **$0.03576 cho 198
từ khoá**.

Endpoint `related_keywords` cũng trả `search_intent_info` ở **mọi** item, và
adapter cũ vứt nó đi ở bước `.map()`. Nếu bạn viết adapter từ khoá mới, giữ
trường đó lại.

### Đo theo THỊ TRƯỜNG, không theo ngành

Đây là chỗ dễ sai nhất. Kho từ khoá của `moving-services` chỉ có **ba mẫu
câu** — `moving services {city}`, `movers {city}`, `moving companies {city}`
— nên rất dễ kết luận "cả ngành một ý định". Đo 198 chuỗi thật:

| Ý định | Từ khoá | Ví dụ |
|---|---|---|
| commercial | 133 | moving companies new york |
| informational | 41 | **movers chicago** |
| navigational | 13 | movers loganville |
| transactional | 11 | **movers pflugerville** |

**Khác nhau không nằm ở mẫu câu.** Cùng `movers {city}`: Chicago là
informational, Pflugerville là transactional. Một nhãn chung cho cả ngành là
áp nhãn của đa số lên 65 thị trường không thuộc nhóm đó.

### Ba ràng buộc khi đưa ý định vào prompt

1. **Không nới quy tắc nào.** Không ý định nào cho phép nói về giá cước, lịch
   trống hay mức bận của hãng — không nguồn nào đo những thứ đó, và một ý
   định "sẵn sàng đặt" không làm dữ liệu xuất hiện.
2. **Chưa đo được thì nói thẳng là chưa biết**, giữ giọng trung tính. Rơi về
   `commercial` là cách 54 thị trường informational nhận giọng so sánh mà
   không ai thấy.
3. **Ý định phải vào fingerprint.** Nếu không, đo xong ý định mà trang vẫn
   trả về đoạn viết theo brief cũ — im lặng, vì cache vẫn "hợp lệ".

### Kiểm

```bash
tsx scripts/audit-intent-match.ts    # thoát khác 0 nếu còn đoạn lệch
```

Phép đo phải bắt theo **cấu trúc câu**, không theo từ. Bản đầu của tôi bắt cả
chữ `quote` và báo 5/27 đoạn còn lệch; đọc cả 5 thì không đoạn nào lệch —
chúng dùng `quote` theo nghĩa *hỏi giá ở hãng đã chọn*. Cùng lỗi đó làm nhóm
`informational` trông như 93% lệch, trong khi thật ra là 22% và chỉ 8 đoạn.
**Sai theo hướng phóng đại cũng tốn tiền**: nó biến việc $0.21 thành việc
trông như phải xin thêm ngân sách $0.95.

## 3.7c ⚠️ Trang CỤM có endpoint riêng — `/cluster-interpretation`

Mục 3.7 nói về đoạn diễn giải của **một ZIP**. Trang cụm gộp nhiều ZIP thì
không dùng được endpoint đó, và đây là chỗ dễ bỏ sót nhất khi dựng site
mới — vì bỏ sót nó **không gây lỗi nào**: trang cụm vẫn build, vẫn lên
sitemap, chỉ là không có chữ AI nào trên đó.

Đo trên site đầu tiên trước khi có endpoint này: **161 ZIP đã có đoạn AI,
127 hiện ra trên trang, 34 nằm im** — chúng là thành viên của cụm, và trang
cụm không hỏi đoạn của từng thành viên. Không log, không 404, không cảnh
báo. Chỉ là 34 đoạn văn đã trả tiền để sinh mà không ai đọc được.

### Vì sao không ghép đoạn của từng ZIP lại

Vì trang cụm nói về một **dải**, không phải một điểm. Brooklyn có 23 ZIP;
ghép 23 đoạn "tỷ lệ sở hữu nhà ở 11201 là 10,9%" lại với nhau cho ra một
trang không ai đọc hết và lặp cấu trúc 23 lần. Đoạn cấp cụm nói thứ khác
hẳn — nó nêu hai đầu dải và **ZIP nào nằm ở mỗi đầu**:

> Brooklyn's 23 ZIP codes are far from interchangeable: homeownership ranges
> from 10.9% at the low end to 67.3% at the high end, median home values from
> $549,400 to $1.67 million…

Đó là câu chỉ viết được khi nhìn cả cụm, và cũng là lý do trang cụm không
phải thin content: nó trả lời một câu hỏi mà 23 trang riêng lẻ không trả
lời được.

### Hợp đồng

```
GET /api/v1/niches/{vertical}/cluster-interpretation?zips=11201,11203,...
```

Nhận **tập ZIP**, không nhận mã cụm. Hai bên không có chung tên cho cụm:
quy tắc gộp sống ở site (`clusterKey` theo từ khoá), HQ chỉ biết tập ZIP.
Và §3.5 đã ghi `mainKeyword` **đổi được** — một đợt sửa mẫu đã đổi chuỗi của
233/582 market — nên mã cụm dạng chuỗi từ khoá sẽ hỏng lặng lẽ vào lần sửa
tiếp theo. Tập ZIP đổi khi và chỉ khi cụm thật sự đổi.

**200** — đo thật trên production 13/9/2026:

```json
{
  "clusterId": "25da2925675d8295ad309b70",
  "memberZips": ["11201", "11203", "…"],
  "text": "Brooklyn's 23 ZIP codes are far from interchangeable: …",
  "textFingerprint": "2e6c2ca65bd1440e"
}
```

`textFingerprint` cùng ý nghĩa với endpoint per-zip (§3.5): so nó để biết
đoạn văn đã đổi mà không phải so cả chuỗi.

### Bốn hành vi đã đo, đừng đoán lại

| Gửi | Nhận | |
|---|---|---|
| Đủ 23 ZIP | `200` | |
| **Xáo trộn thứ tự** 23 ZIP đó | `200`, **cùng** `clusterId` | tập ZIP được sắp xếp trước khi băm — site không cần tự sắp |
| **Thiếu 1 ZIP** (22/23) | `404`, `clusterId` **khác** | đây là tính năng, không phải lỗi — xem dưới |
| **1 ZIP** | `200` | hợp lệ — hub của bang chỉ publish một ZIP dùng đúng đường này |
| ZIP sai định dạng, hoặc thiếu `zips` | `400` | từ chối cả lô, không lọc bỏ rồi chạy tiếp |

Dòng **1 ZIP** từng là `400`, và đó là một lỗi sống 1 ngày: hub của một bang
chỉ publish một ZIP cần đúng đường này, vì khẳng định của nó khác hẳn trang
ZIP bên dưới — "ZIP này đứng đâu trong toàn bộ tập đã publish" thay vì "số
liệu của ZIP này". Phục vụ đoạn của trang market ở hub là đăng trùng nội
dung giữa hub và trang con. Bảy đoạn đã sinh xong và nằm trong DB trong khi
guard cũ trả 400 — tính năng hoàn chỉnh ở mọi tầng trừ một dòng điều kiện.

Ô thứ ba là ô quan trọng. **Khớp phải đúng toàn bộ tập.** Bỏ một ZIP đi là
hỏi về *một cụm khác* — và nếu API trả về đoạn của cụm 23 ZIP cho câu hỏi
về cụm 22 ZIP, trang sẽ nêu một dải có hai đầu mà trang đó không chứa. Số
đúng, nguồn đúng, và vẫn sai. Cùng lý do đó, `?zips=11201,ABCDE` bị từ chối
cả lô thay vì lọc bỏ `ABCDE`: lọc bỏ im lặng biến câu hỏi thành câu hỏi
khác mà người gọi không biết.

Hệ quả cho site: **tập ZIP gửi lên phải đúng bằng tập ZIP trang đó render.**
Nếu site lọc thành viên (bỏ ZIP thiếu dữ liệu, chẳng hạn) thì phải lọc
*trước* khi gọi, và gọi bằng tập đã lọc.

### ⚠️ KHÔNG có `?generate=1`

Endpoint per-zip có `?generate=1` (§3.7). Endpoint này **chỉ đọc**. Sinh
một đoạn cụm tốn $0,02–0,08 và cần fact set dạng dải, nên nó là việc chủ
động ở HQ:

```bash
tsx scripts/generate-cluster-text.ts
```

Một trang bị crawl nhiều lần không được phép biến thành hoá đơn.

`404` nghĩa là **chưa sinh**, không phải lỗi. Site render trang không có
đoạn — đúng như hành vi hôm nay — và báo về HQ để sinh.

### Kiểm khi dựng xong

Bảng `AiClusterGeneration` giờ chứa **ba loại** đoạn, phân biệt bằng tập ZIP
chứ không bằng một cột loại — vì cả ba là cùng một bài toán và cùng một
validator:

| loại | tập ZIP | nói gì |
|---|---|---|
| trang cụm | nhiều ZIP chung từ khoá + hạt | dải trong cụm |
| hub bang | mọi ZIP bang đó publish | dải trong bang |
| hub bang một ZIP | đúng 1 ZIP | ZIP đó đứng đâu trong TOÀN BỘ tập đã publish |

Đo 14/9/2026: **55 đoạn đạt** — 31 cụm + 17 hub bang + 7 hub một-ZIP.

Kiểm: đếm trang cần đoạn trên site, đếm đoạn ở HQ, hai số phải bằng nhau.
Nếu site có 31 trang cụm mà chỉ gọi thành công 28 lần thì 3 trang đang thiếu
chữ — và như đã nói ở đầu mục, không có gì báo cho bạn biết.

### Site gửi TẬP ZIP nào, cho trang nào

Cả ba loại dùng chung một endpoint. Thứ quyết định là tập ZIP, nên gửi sai
tập là `404` im lặng — trang vẫn build, chỉ là không có chữ.

| trang | gửi gì |
|---|---|
| trang cụm | ZIP thành viên của cụm |
| hub bang | **mọi ZIP bang đó publish** — market lẻ CỘNG thành viên cụm |
| hub bang 1 ZIP | đúng ZIP đó |

Hub bang phải lấy từ manifest, **không phải từ danh sách đang hiển thị trên
trang**: hub thường chỉ liệt kê market lẻ và link sang trang cụm, nên lấy
theo những gì đang hiện sẽ thiếu mọi thành viên cụm — một tập khác, một
`clusterId` khác, `404`.

⚠️ **Bang mà MỌI ZIP nằm trong đúng MỘT trang cụm thì hub KHÔNG lấy đoạn.**
Tập của bang bằng hệt tập của cụm, nên hai trang nhận cùng một đoạn và đăng
trùng nhau từng chữ — giữa một trang và trang con của nó. Đo trên site đầu:
2 bang như vậy. HQ đã bỏ qua chúng lúc sinh, site cũng phải bỏ qua lúc
render; cả hai đầu cùng biết thì không đầu nào dựa vào đầu kia.

Ngoại lệ của ngoại lệ: bang cluster-only có **từ hai cụm trở lên** thì tập
bang khác tập từng cụm, và đoạn cấp bang là chính đáng — nó nói dải GIỮA các
cụm. Hôm nay chưa site nào có ca đó.

### ⚠️⚠️ Bài học "một giả định, ba tầng"

Tập MỘT ZIP là hợp lệ. Nhưng giả định *"cụm nghĩa là từ 2 ZIP trở lên"* từng
được viết độc lập ở **ba tầng**, và sửa tầng này không làm lộ tầng sau:

```
1. route /cluster-interpretation   → 400 "Cần ít nhất 2 ZIP"
2. HQ getCachedClusterText         → dựng fact set cụm, null với 1 ZIP
3. site fetchClusterInterpretation → not-found trước cả khi gọi mạng
```

Suốt ba vòng sửa, 7 đoạn đã sinh xong, mọi cổng kiểm ở HQ đều qua, hai luật
của site cũng qua — và trang vẫn đúng 171 từ. Một giả định lặp ở ba tầng
không phải ba lớp phòng thủ, mà là ba chỗ phải nhớ sửa.

Cách duy nhất phát hiện là **đo ở đầu cuối**: `HTTP 200` ở tầng API không
chứng minh chữ lên tới trang. Khi dựng site mới, kiểm bằng cách đếm từ trên
trang thật, đừng kiểm bằng mã trạng thái của endpoint.

---

## 3.8 `/api/v1/content-rules` — hợp đồng nội dung, và cách CHỨNG MINH bạn tuân thủ

Endpoint này chưa từng có trong tài liệu cho tới 2026-09-10, dù nó đã chạy
nhiều ngày. Nghĩa là mọi publisher trước đó chỉ biết tới nó nếu có người nói
miệng — và một trường trong API mà không tài liệu nào nhắc tới thì nó chỉ có
mặt cho người đã biết nó có mặt.

```bash
curl -s -H "x-api-key: $KEY" https://hq.cornships.com/api/v1/content-rules
```

### Nó KHÔNG phải danh sách lời khuyên

Điểm khác biệt với mọi checklist SEO bạn từng đọc: mỗi luật ở đây đi kèm
**vector conformance**, và verdict của vector **được đo bằng cách chạy validator
thật tại thời điểm gọi**, không phải một hằng số ai đó gõ vào.

Nên bạn không đọc mô tả rồi tự diễn giải. Bạn chạy vector qua validator của
mình và khẳng định verdict khớp. Site nào pass đã **chứng minh** validator của
nó đồng ý với HQ.

`scripts/verify-content-rules.ts` trong repo HQ là bản tham chiếu — chép vòng
lặp đó. Phần quan trọng là **đáp án đến từ HQ qua đường mạng**, không phải từ
một hằng số trong repo bạn. Một hằng số là bản sao thứ hai, và bản sao thứ hai
trôi lệch.

### Các mục trong response

| Mục | Nội dung |
|---|---|
| `version` | Bump khi có trường mới hoặc luật mới. Hiện là `6`. |
| `rounding.vectors` | Luật làm tròn: model được in con số nào, không được in con số nào |
| `jsonLd.vectors` | **Mới ở version 6.** Hai luật cho structured data — xem dưới |
| `reservedTerms` | Term thuộc về trang pillar, không được dùng làm anchor ở nơi khác |
| `metricResolutions` | Mỗi chỉ số đo ở cấp nào (ZIP/COUNTY/STATE) — đọc trước khi cộng gộp |
| `requiredPages` | Trang bắt buộc (`/privacy`, `/terms`, `/about`, `/contact`) kèm đường dẫn thay thế |
| `declaredRules` | Luật nào tồn tại, ai thực thi, và **có bằng chứng chạy được hay chưa** |

### `jsonLd` — vì sao nó tồn tại riêng

Luật `displayed-only` chặn việc bịa chữ số trong **văn bản**, và trước version 6
nó dừng ở ranh giới HTML. JSON-LD là bề mặt **duy nhất viết cho máy đọc** và
trước đó **không ai kiểm**.

Đo trên một publisher thật (2026-09-10, 56/192 URL): **96/449 PropertyValue**
công bố chữ số không có ở đâu trên trang — `46.02954943221133` trong khi trang
in `46.0%`.

Hai luật:

- **`jsonld-value-displayed-only`** — giá trị trong JSON-LD không được công bố
  chữ số trang không in ra. Được thêm số 0 ở cuối, **không** được bớt chữ số.
  Chỉ áp cho giá trị có phần thập phân: đổi thang (`2249409000` → `$2.25
  billion`) là chính sách ĐƯỢC PHÉP, nên bắt số nguyên xuất hiện nguyên dạng sẽ
  là đòi JSON-LD công bố dữ liệu **kém chính xác hơn** dữ liệu thật.
- **`jsonld-aggregate-declares-scope`** — `measurementTechnique` phải có đúng một
  trong hai hình dạng: `<nguồn> (<zip|county>-level)`, hoặc `<phép tính> of
  <nguồn> across <N> <danh từ phạm vi>`.

Mỗi vector có `rule`, `value`, `visibleText`, `why`, `expect`, `measuredReason`.
`measuredReason` là câu vị ngữ tự giải thích lúc chạy — nếu nó không khớp với
`why`, tin `measuredReason`, vì `why` do người viết còn nó thì không.

### Đọc `declaredRules` cho đúng

Trường `provenBy` là phần quan trọng nhất và dễ bỏ qua nhất. **Luật không có
`provenBy` là luật chưa ai thấy nổ** — nó đọc y hệt một luật đang bảo vệ điều
gì đó. Hiện 2/9 luật ở trạng thái đó, và cả hai đều là luật văn bản.

`notAppliedTo` liệt kê đường dẫn luật **không** áp dụng, kèm lý do. Đừng tự suy
ra ngoại lệ: ví dụ đang có là `stay-in-trade` cấm hứa bảo hành, trong khi trang
`/terms` **bắt buộc** phải từ chối bảo hành — và chính `requiredPages` đòi bạn
có trang đó. Scanner nào tự suy sẽ suy khác nhau.

---

## 3.9 ⚠️ Site PHẢI công bố `GET /api/inventory` — nếu không, HQ đoán và đoán sai

Head Quarter cần trả lời "market này đã có trang chưa" để không mời viết
trùng. Nó **không tự suy ra được**, và đây là lý do:

- Site dùng nhiều dạng URL cho một market: `/vertical/state/city` (trang cụm
  hoặc thành phố một zip) và `/vertical/state/city-zip` (trang riêng).
- Trang **cụm** đặt tên theo **TỪ KHOÁ**, không theo tên thành phố. Những zip
  sau `/moving-services/ny/brooklyn` đều mang `city: "New York"` trong dữ
  liệu HQ — **không phép ghép nào theo tên thành phố tìm ra chúng**.
- Quy tắc cụm (`isPublishable`) sống ở repo site. Sao chép nó sang HQ là tạo
  định nghĩa thứ hai về việc trang nào tồn tại.

Đo 12/9/2026 khi HQ còn đoán bằng tên thành phố: danh sách mời viết **174
bài, và cả 174 đã có trang** — 127 dạng `/city-zip`, 47 được trang cụm phủ.
Sau khi đọc `/api/inventory`: **0 ứng viên**, đúng thực tế.

**Hợp đồng:**

```jsonc
GET /api/inventory
{
  "generatedAt": "2026-09-07T12:46:37.067Z",
  "zipCount": 256,     // số ZIP — nhiều zip dùng chung một trang cụm
  "pageCount": 158,    // số TRANG — khác zipCount có chủ ý
  "entries": [
    { "zip": "11212", "path": "/moving-services/ny/brooklyn", "kind": "cluster" },
    { "zip": "32822", "path": "/moving-services/fl/orlando-32822", "kind": "market" }
  ]
}
```

- `kind: "market"` = trang riêng. `kind: "cluster"` = trang gộp.
- **Dựng từ chính hàm quyết định route** (`publishedMarkets` / `clusters`),
  không phải từ một danh sách viết tay — nếu không nó sẽ lệch với thứ thật
  sự resolve, và lệch âm thầm.
- Không đặt `export const dynamic` nếu site bật `cacheComponents` — build sẽ
  từ chối. Route chỉ đọc manifest ở module scope thì vốn đã tĩnh.

Phía HQ đọc theo **ZIP**, không theo đường dẫn, và coi `entries` rỗng là
**lỗi** chứ không phải "site chưa có trang nào".

## 3.10 ⚠️ Ba bẫy đã đo được khi site đọc WordPress và tự revalidate

Ba lỗi này đều **im lặng** — không dòng log nào, và triệu chứng trông hệt như
"chưa có nội dung".

### `per_page` của WordPress tối đa 100, và nó TỪ CHỐI chứ không cắt bớt

`app/sitemap.ts` của site đầu gọi `getPosts(200)`. WordPress trả:

```json
{"code":"rest_invalid_param","message":"Invalid parameter(s): per_page",
 "per_page must be between 1 (inclusive) and 100 (inclusive)"}
```

Lớp fetch xử lý `!res.ok` bằng `return null`, hàm gọi đổi `null` thành `[]`
— nên **bài viết chưa bao giờ vào được sitemap**, và không nơi nào ghi lại.
Đăng 125 bài thì cả 125 vắng mặt, còn danh sách rỗng trông y hệt "chưa có
bài nào".

Phân trang theo lô 100, và **chặn ngay trong hàm** chứ đừng trông vào nơi
gọi nhớ giới hạn — lỗi này sinh ra đúng vì nơi gọi không nhớ.

### "Không tới được" khác "bị từ chối", đừng gộp

| | Nghĩa | Xử lý |
|---|---|---|
| `unreachable` | WordPress tắt, mạng hỏng, chưa cấu hình | Suy biến về rỗng, im lặng — **đúng**, một blog tắt không được kéo theo 300 trang địa phương |
| `rejected` (4xx/5xx) | WordPress trả lời, và trả lời là "không" | **Lỗi lập trình phía gọi.** Ghi một dòng stderr rồi mới suy biến |

Suy biến về rỗng là đúng. Thứ phải bỏ là **sự im lặng**, không phải sự chịu
đựng.

### `/api/revalidate` phải nhận được cả LÔ

Nếu bước cuối của nó là purge toàn zone Cloudflare, thì gọi 35 lần cho 35 zip
là 35 lần xoá sạch edge — 34 lần đầu vô nghĩa, và Cloudflare giới hạn tần
suất purge. Head Quarter sinh lại nội dung **theo lô**, nên hợp đồng phải là:

```jsonc
{ "type": "interpretation", "zips": ["10002", "11201", "60634"] }
```

Từ chối cả lô khi có phần tử sai định dạng, đừng lọc bỏ phần sai rồi chạy
tiếp: một lô 36 zip mà 3 cái gõ sai thì 33 cái kia được revalidate và **không
ai biết 3 cái bị bỏ**.

## 3.11 ⚠️ Ba cái bẫy của Cloudflare, đo trên site đầu tiên

Cả ba đều không gây lỗi lúc build và chỉ hiện ra trong báo cáo thu thập.

### `/cdn-cgi/l/email-protection` — trang 4xx bạn không viết

Bật Email Address Obfuscation (mặc định BẬT trên Cloudflare), mọi
`<a href="mailto:...">` bị viết lại thành
`/cdn-cgi/l/email-protection#<mã>`. Truy cập thẳng URL đó trả **404**: địa
chỉ thật nằm sau dấu `#`, chỉ JavaScript đọc được.

Đo 14/9/2026 trên `atmovingservices.com`, 194 trang: đây là trang 4xx **duy
nhất**, VÀ cũng chính là **"1 trang thiếu thẻ canonical"** — cùng một URL,
hai dòng trong bảng lỗi, vì trang 404 không render layout nên không có
canonical để đếm.

Cách chữa — chặn ở `robots.txt`, đừng tắt Email Obfuscation:

```ts
// app/robots.ts
disallow: ["/api/", "/cdn-cgi/"],
```

Tắt tính năng kia là phơi địa chỉ email cho trình quét. Googlebot vốn đã bỏ
qua `/cdn-cgi/`; trình thu thập bên thứ ba (DataForSEO, Screaming Frog) thì
không.

### robots.txt thật KHÔNG phải thứ `app/robots.ts` sinh ra

Cloudflare chèn một khối "Managed content" **phía trên** khối của site, kèm
`Content-Signal` và một danh sách `Disallow: /` cho các bot AI. Kết quả là
file có **hai** nhóm `User-agent: *`.

Chuẩn REP nói các nhóm khớp cùng một user-agent được gộp lại, nên luật của
bạn vẫn có hiệu lực. Nhưng hệ quả thực tế: **đừng kiểm robots bằng cách đọc
code**. Đọc `curl https://<domain>/robots.txt` — thứ crawler thật sự nhận.
Một thiết lập ở Cloudflare có thể thêm luật mà repo không biết gì.

### Cache biên giữ HTML tới 24 giờ

`s-maxage=86400`. Sau khi gọi `/api/revalidate` và nhận `200`, trang vẫn có
thể trả nội dung cũ trong vài phút cho tới khi purge lan hết.

"revalidate trả 200" KHÔNG đồng nghĩa "người đọc thấy bản mới". Kiểm bằng
một tham số truy vấn để né cache biên (`?cb=123`) — nếu URL có tham số đúng
mà URL trần sai thì đó là cache, không phải lỗi site.

---

## 3.12 ⚠️ Lỗi OnPage đã đo trên site đầu — tránh từ đầu, đừng sửa sau

Quét DataForSEO OnPage trên `atmovingservices.com`, 194 trang, điểm 97,2.
Mỗi mục dưới đây là một lỗi THẬT đã nổ, kèm nguyên nhân và luật để site mới
không lặp lại. Sắp theo số trang dính, không theo mức độ.

### `title_too_long` — 78/194 trang, và nguyên nhân KHÔNG phải cái ai cũng nghĩ

Bản đầu của mục này quy lỗi cho việc đưa ZIP vào tiêu đề để chống trùng.
**Sai.** Đo lại bằng cách đọc 194 tiêu đề thật:

```
"Moving Services in Nashville-Davidson, TN — 2 ZIP codes compared | AT Moving Services"
                                                                  └──────────────────┘
                                                                   21 ký tự, MỌI trang
```

`title.template` ở `app/layout.tsx` nối `" | <tên site>"` vào mọi trang, và
`generateMetadata` của từng trang không hề biết. Bỏ riêng nó:

| | quá 60 | quá 65 | dài nhất | trùng |
|---|---|---|---|---|
| trước | 178 | **78** | 85 | 0 |
| sau | 3 | **0** | 64 | 0 |

Toàn bộ vấn đề nằm ở một dòng cấu hình, không nằm ở 78 trang. Và nó vô hình
với người đọc code từng trang — chỗ đặt tiêu đề và chỗ nối hậu tố cách nhau
cả cây thư mục.

**Luật cho site mới:**

1. Trang pSEO tự khai tiêu đề đầy đủ bằng `title: { absolute: ... }`. Chúng
   đã tự đủ nghĩa và đã dài; hậu tố chỉ đẩy phần phân biệt ra khỏi chỗ
   Google cắt.
2. Trang biên tập (`/about`, `/contact`, `/privacy`) **giữ** template. Hậu
   tố đáng giá đúng ở đây: `"About"` một mình là tiêu đề vô nghĩa. Bỏ
   template một cách mù quáng biến nó thành 5 ký tự.
3. Đo tiêu đề bằng cách **render trang rồi đọc thẻ `<title>`**, đừng đo
   chuỗi trong `generateMetadata`. Hai thứ đó khác nhau đúng 21 ký tự, và
   đó là toàn bộ câu chuyện này.

ZIP trong tiêu đề vẫn là chuyện có thật và vẫn đáng cân nhắc — 48 trang từng
dùng chung một tiêu đề trước khi thêm ZIP — nhưng nó KHÔNG phải nguyên nhân
của 78 trang này. Sau khi bỏ hậu tố, tiêu đề có ZIP dài 39-53 ký tự và
không trang nào trùng.

### `low_content_rate` — 192/194 trang, và 158 trong số đó BỊ BÁO OAN

DataForSEO tính chữ / HTML **thô**. Với Next.js App Router, **61% HTML là
RSC payload** (`self.__next_f.push`) — chính những câu văn đó serialize lần
thứ hai để hydrate. Đo trên một trang thị trường: 88 KB HTML, 54 KB payload,
**1.182 từ thật**, tỷ lệ thô 4,4% nhưng tỷ lệ trên markup thật ~18%.

**Luật:** đừng dùng tỷ lệ này. Đếm **TỪ hiển thị**:

```
độ sâu 3, trang thị trường   891 - 1.295 từ   khoẻ
độ sâu 2, hub bang            111 -   541 từ   MỎNG  ← chỗ cần chữa
/blog                                 103 từ   MỎNG
```

Ngưỡng dùng được: **dưới 300 từ là mỏng**. Và nhớ rằng thêm chữ để nâng tỷ
lệ là nhồi chữ cho máy quét — thứ cần là trang có gì để đọc.

### `has_render_blocking_resources` — 193/194 trang, KHÔNG phải vấn đề

Đúng MỘT tài nguyên, và nó là `<script noModule>` — polyfill Next.js sinh tự
động cho trình duyệt không hiểu ES module. **Trình duyệt hiện đại không tải
nó.** Trang nén 11 KB, TTFB 155 ms, tải xong 156 ms.

**Luật:** đừng sửa. Gỡ nó phải đụng cấu hình build, đổi lấy 0 cải thiện cho
người đọc và rủi ro hỏng trình duyệt cũ. Nhưng PHẢI phân biệt được nó với
script chặn thật — `scripts/audit-technical-seo.ts` nêu TÊN tài nguyên chặn,
và chỉ cảnh báo khi có script đồng bộ hoặc CSS bên thứ ba trong `<head>`.

### `low_character_count` — 13 trang

Khác `low_content_rate`: đây là đếm ký tự thật, và 13 trang đó mỏng thật.
Trùng với nhóm hub bang ở trên.

### `is_4xx_code` + thiếu canonical — 1 trang, cùng một URL

`/cdn-cgi/l/email-protection` của Cloudflare. Xem §3.11 — chặn ở `robots.txt`.

### `seo_friendly_url_*` — 1-2 trang

URL `/data` thiếu từ khoá. Nhỏ, nhưng lưu ý: **bốn mục này từng hiện 167
trang mỗi mục** vì HQ đọc ngược ngữ nghĩa — xem cảnh báo ngay dưới.

### ⚠️⚠️ Đọc báo cáo OnPage: DataForSEO dùng HAI quy ước ngược nhau

Trong cùng một object `checks`, họ trộn hai ý nghĩa và tên trường không nói
ra. Đo được trên cùng một lần crawl:

| trường | trên trang `/about` (URL 6 ký tự, sạch) | nghĩa |
|---|---|---|
| `seo_friendly_url_relative_length_check` | `true` | ĐẠT |
| `seo_friendly_url_dynamic_check` | `true` | ĐẠT |
| `title_too_long` (title 64 ký tự) | `false` | không dính lỗi |

Một URL 6 ký tự không thể vừa "quá dài" vừa "động". **Họ `*_check` đếm số
trang ĐẠT; mọi trường khác đếm số trang DÍNH.**

Đọc sai chiều này biến 4 mục lành thành "167 trang phải sửa" và giấu mất
trang 4xx thật. Số càng to càng giống việc khẩn, nên sai theo chiều này tốn
nhiều thời gian hơn là bỏ sót. HQ đã sửa cách đọc; nếu bạn gọi DataForSEO
trực tiếp thì đây là điều phải biết trước.

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
9. **Công bố `GET /api/inventory`** (§3.9) — HQ cần nó để biết ZIP nào đã
   có trang và trang đó là riêng hay cụm
10. **Sinh lớp AI ở HQ** — xem bên dưới, đây là bước duy nhất tốn tiền

### Bước 10: sinh lớp AI, sau khi site đã chạy

Thứ tự này bắt buộc, không phải sở thích. HQ đọc `/api/inventory` để biết
cụm gồm những ZIP nào — quy tắc gộp sống ở site, HQ không tính lại (§3.7c).
Chạy trước khi site lên thì HQ không có gì để đọc.

```bash
npm run cluster:generate -- --site <host>        # trang cụm
npm run state:generate -- --site <host>          # hub bang (từ 2 ZIP)
npm run solo-state:generate -- --site <host>     # hub bang chỉ 1 ZIP
```

**Ba lệnh, không phải một**, vì site có ba loại trang cần đoạn và mỗi loại
nói một khẳng định khác — xem bảng ở §3.7c. Bỏ sót một lệnh nghĩa là một
loại trang im lặng không có chữ, và không gì báo cho bạn biết.

⚠️ **Hub bang mới là chỗ mỏng, không phải trang thị trường.** Đo 14/9/2026
trên site đầu, đếm TỪ hiển thị theo độ sâu đường dẫn:

| độ sâu | loại trang | số từ |
|---|---|---|
| 3 | 158 trang thị trường | 891 – 1.295 |
| 2 | 26 trang hub bang | **111 – 541**, giữa 225 |

Và trong 4 trang Google đã crawl rồi **không lấy**, hai trang là hub. Google
đọc hub mỏng rồi từ chối, trong khi 158 trang dày thì chưa crawl tới. Nếu
chỉ chạy `cluster:generate` thì đúng phần Google đang từ chối là phần không
được chữa.

Sau ba lệnh, hub bang lên 364–805 từ.

`--site` bắt buộc từ site thứ hai trở đi. Với một site thì bỏ được, nhưng
nếu có nhiều site mà không nêu, script **dừng lại và liệt kê** thay vì đoán:
đoán sai ở đây nghĩa là tiêu tiền sinh đoạn cho cụm của niche khác, và đoạn
đó vẫn qua validator — số thật, nguồn thật, của nơi khác.

Sinh theo **volume giảm dần**, nên nếu chạm trần ngân sách giữa chừng thì
thứ đã sinh là thứ đáng nhất. Chạm trần không hỏng gì: cụm chưa sinh giữ
nguyên trạng thái "chưa có", và endpoint trả `404` — site render không có
đoạn, đúng hành vi đã mô tả ở §3.7c.

**Ngân sách, đo trên niche đầu tiên** (`moving-services`, sổ `aiSpend`,
13/9/2026):

| | |
|---|---|
| Trọn niche: 127 trang riêng + 31 trang cụm | **$7,65** |
| Mỗi đoạn cụm hoàn chỉnh | ~$0,047 |
| Mỗi lượt gọi | ~$0,02 |

$7,65 là **tổng đã tính cả lần trượt** — 401 dòng sổ chi cho 337 đoạn nằm
trong cache, tức khoảng $0,95 trả cho những lần model viết sai rồi bị từ
chối. Đừng lập ngân sách theo số đoạn nhân đơn giá: mọi đoạn không đạt
ngay lần đầu, và trần đặt sát sẽ dừng đúng lúc đang viết lại.

Trần chỉnh ở `AppConfig` key `ai`, trường `spendCapUsd`. Trần hiện tại
**$15**, đã tiêu **$7,65**.

### Kiểm bước 10 đã xong

```bash
npm run cluster:generate -- --site <host> 0    # 0 = không sinh, chỉ đếm
```

In ra "N cụm". Số đó phải bằng số trang cụm trên site. Không có gì tự báo
nếu lệch — xem đoạn mở đầu §3.7c.

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
  "https://hq.cornships.com/api/v1/niches" | python3 -m json.tool
```

```bash
curl -s -H "Authorization: Bearer <API_KEY>" \
  "https://hq.cornships.com/api/v1/niches/moving-services/markets/10002" | python3 -m json.tool
```
