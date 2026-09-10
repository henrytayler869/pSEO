# QC Technical SEO — bàn giao cho session "pSEO Control Panel"

> **Tài liệu bàn giao.** Bên gửi: session QC Technical SEO. Bên nhận: session
> giữ Head Quarter, để publisher mới KẾ THỪA thay vì tự phát hiện lại.
>
> Mọi con số trong tài liệu này **đo được**, không phát biểu. Lệnh tái lập nằm
> ở §7. Publisher đo: **atmovingservices.com**, lúc **2026-09-10T07:56Z**, đọc
> **56/192 URL** trong sitemap (lấy mẫu theo độ sâu, lấy hết các nhóm nhỏ),
> **34 Dataset**, **449 PropertyValue**.

---

## 1. Kết luận một dòng

Hạ tầng crawl/index của site **đúng ở gần như mọi điểm cổ điển** — redirect gom
host, 404 cứng, nén, canonical trên mọi trang nội dung, một h1, sitemap khai
trong robots. Cái hỏng nằm ở chỗ không ai nhìn: **JSON-LD là bề mặt duy nhất
viết cho máy đọc, và là bề mặt duy nhất không luật nào của dự án chạm tới.**
21.4% giá trị công bố ở đó mang chữ số mà trang không hề in ra.

---

## 2. Đo được gì

| Hạng mục | Kết quả đo | Mức |
|---|---|---|
| `jsonld-value-displayed-only` | **353/449 PropertyValue đạt** — 96 ca công bố chữ số không có trên trang | lỗi |
| `jsonld-aggregate-declares-scope` | **449/449 đạt** | đạt |
| Canonical | thiếu ở **trang chủ**; `/?utm_source=…` trả 200 cũng không có canonical. 55 trang còn lại đều tự trỏ chính mình | lỗi |
| Trang index được mà không có trong sitemap | `/blog/hello-world`, `/moving-services/dc` (+ `/moving-services/ks`, tìm tay) | cảnh báo |
| Hub bang không được index `/moving-services` link tới | `dc`, `ks` — 24/26 bang có hub trong danh sách | cảnh báo |
| `lastmod` | **190/194 URL dùng chung một giá trị** `2026-09-07T12:46:37.067Z`; 4 URL không có. KHÔNG phải giờ build — xem §3.4, chỗ này tôi kết luận sai một lần | cảnh báo |
| Dataset thiếu `license` / `temporalCoverage` | 68 ca (mọi Dataset đo được) | cảnh báo |
| Favicon | không có `<link rel="icon">`, `/favicon.ico` → 404 | cảnh báo |
| JSON-LD vắng mặt | `/blog` không có khối nào; bài blog không có `Article`/`BlogPosting` | cảnh báo |
| Title > 60 ký tự | 47/56 | cảnh báo |
| Meta description > 160 ký tự | 40/56 | ghi nhận |
| `http→https`, `www→apex` | 301, đúng | đạt |
| URL không tồn tại | 404 cứng (không phải soft 404) | đạt |
| Trailing slash | 308 về dạng không slash | đạt |
| Nén / HTTP2 / HTTP3 | `br`, h2, `alt-svc: h3` | đạt |
| FAQPage khớp nội dung hiển thị | mọi câu hỏi đều có trên trang | đạt |

---

## 3. Phát hiện chính, theo thứ tự đáng sửa

### 3.1 JSON-LD công bố chữ số mà trang không in ra — 96/449

Đo trên `/moving-services/ca/sacramento-95823`:

| Trang in cho người | JSON-LD nói với máy |
|---|---|
| `46.0%` | `"value": 46.02954943221133` |
| `10.7%` | `"value": 10.67673554622053` |
| `$71,674` | `"value": 71673.7509559011` |

Đây **không phải** lỗi "số sai". Giá trị thô thường là giá trị đúng nhất tồn
tại. Lỗi là ở chỗ: một ước lượng ACS 5 năm có sai số ±1–2 điểm phần trăm đang
được khai **16 chữ số có nghĩa**, ở đúng bề mặt mà máy tin không hỏi lại.

Điều làm nó thành vấn đề của HQ chứ không phải sở thích: **dự án đã có luật này
rồi.** `rounding.policy = "displayed-only"` nói mọi chữ số vượt quá mức prompt
in ra là chữ số bịa, và có 8 vector chứng minh luật đó chạy. Luật đó **dừng ở
ranh giới HTML**. Cùng một con số, viết trong văn bản thì bị từ chối, viết
trong `<script type="application/ld+json">` thì đi thẳng ra ngoài.

Cách sửa ở phía site: `variableMeasured[].value` lấy từ cùng trường `display`
mà prompt đã dùng, không lấy từ giá trị thô.

### 3.2 Trang chủ không có canonical

Trang chủ là trang duy nhất trong 56 trang đo được không có `<link
rel="canonical">`. `https://atmovingservices.com/?utm_source=qc` trả **200** và
cũng không có canonical — nghĩa là mọi link chia sẻ mang `utm_*`, mọi tham số
quảng cáo, là một URL riêng cùng nội dung, không có gì gom lại.

Trớ trêu: `/moving-services?utm_source=qc` **có** canonical trỏ về bản sạch.
Nên đây không phải quyết định thiết kế, mà là một trang lọt khỏi template.

### 3.3 Sitemap và đồ thị link nội bộ không khớp nhau, không ai kiểm

Ba thứ khác nhau, cùng một gốc:

- `/blog/hello-world` — **bài giữ chỗ mặc định của WordPress**, đang sống, `index, follow`, canonical tự trỏ, link từ `/blog` (nằm trong nav chính). Không có trong sitemap.
- `/moving-services/dc` và `/moving-services/ks` — hub bang, trả 200, `index, follow`. Không có trong sitemap, và **không được `/moving-services` link tới** (24 link bang cho 26 bang có trang nội dung). Đường vào duy nhất là breadcrumb trên trang con của chính chúng.
- Ngược lại: sitemap có `/moving-services/dc/washington` và `/moving-services/ks/olathe`, tức site nộp con mà không nộp cha.

Hệ quả thứ hai, và là hệ quả của HQ: `lib/sitemap/count.ts` dùng **số URL trong
sitemap làm mẫu số** của tỷ lệ index, còn tử số là số trang có impression trên
GSC — gồm cả những trang này. Đúng cái bẫy mà file đó được viết ra để sửa:
*"tỷ lệ vượt 100% trong khi trông vẫn như một phần trăm bình thường"*. Lần
trước mẫu số sai vì đếm post WordPress; lần này mẫu số thiếu vì sitemap không
phủ hết trang index được.

### 3.4 `lastmod` dùng chung một mốc cho mọi trang

**Đính chính, và cách nó được đính chính đáng đọc hơn kết luận.**

Bản đầu của tài liệu này viết "`lastmod` là dấu thời gian build". Sai. Session
Pubsite lấy ra ba mốc mà tôi chưa từng đặt cạnh nhau:

```
190 giá trị lastmod, một giá trị duy nhất:  2026-09-07T12:46:37.067Z
manifest.generatedAt:                       2026-09-07T12:46:37.067Z
build đang chạy lúc đó:                     2026-09-10T09:26:27Z
```

Nó là mốc **nội dung**, không phải giờ build — đúng thiết kế, và `app/sitemap.ts`
nói rõ vì sao không dùng `new Date()`: dưới Cache Components đó là dữ liệu
lúc-request, sẽ làm cả sitemap thành động.

Tôi suy ra "giờ build" từ mỗi việc *mọi giá trị giống nhau*, và không đo. Đó
đúng loại kết luận không kèm phép đo mà tài liệu này đi bắt ở chỗ khác. Ghi lại
thay vì sửa lặng lẽ, vì phần đáng học không phải con số mà là: **một quan sát
đúng (mọi giá trị giống nhau) cộng một suy luận chưa kiểm (nên nó là giờ build)
đọc y hệt một phát hiện.**

**Phần còn đúng, hẹp hơn nhiều:** cả 190 trang dùng chung một mốc, nên nội dung
một trang đổi thì `lastmod` của chính nó không nhúc nhích. Thô, không sai —
khác hẳn "là giờ build" vốn sẽ là sai. Crawler dùng `lastmod` để chọn ghé lại
trang nào, nên một dấu thời gian per-market trong manifest là thứ đáng có.

4 trang tin cậy (`/about`, `/contact`, `/privacy`, `/terms`) vẫn không có
`lastmod` nào.

### 3.5 Dataset thiếu hai trường quyết định giá trị của nó

Mọi Dataset đo được đều thiếu `license` và `temporalCoverage`.
`temporalCoverage` là trường nặng nhất ở đây: với ước lượng 5 năm của ACS,
"kỳ nào" là **một nửa ý nghĩa của con số**, và hiện không có gì trong schema
nói ra. `license` thì gần như miễn phí — dữ liệu liên bang thuộc phạm vi công
cộng.

Ngoài ra: `Organization` không có `logo`, `sameAs`, `contactPoint` (dù
`/contact` tồn tại và được link). Không trang nào có `og:image`, trong khi mọi
trang đều khai `twitter:card: summary` — thẻ card không có ảnh.

### 3.6 Một chỗ site nói với NGƯỜI nhiều hơn nói với MÁY

Trên trang zip, chỉ số dẫn xuất in ra cho người đọc kèm **phép tính**:

> Income arriving with inbound households ÷ Moved in over the year — $71,674, County level across Sacramento County, IRS SOI County Migration

Nhưng `measurementTechnique` của đúng mục đó chỉ ghi `IRS SOI County Migration
(county-level)` — mất chữ `÷`. Nửa văn bản của luật `aggregate-must-declare-scope`
mạnh hơn nửa JSON-LD của nó. Đây là **thứ HQ không kiểm được từ xa** (xem §6).

---

## 4. Phần vào được endpoint HQ

Ba mục dưới đây thoả cả ba điều kiện HQ đặt: vị ngữ máy kiểm được, vector hai
chiều, verdict **đo** bằng cách chạy vị ngữ thật.

Code đã có sẵn trong repo, chưa nối vào `registry.ts` — chỗ đó là của session
HQ:

- `lib/content-rules/jsonld-rules.ts` — hai vị ngữ + 12 vector
- `scripts/verify-technical-rules.ts` — chạy vector, kiểm độ phủ nhánh, kiểm đột biến
- `scripts/audit-technical-seo.ts` — đo site thật, **gọi đúng hai vị ngữ đó** (không có bản copy thứ hai)

### 4.1 `jsonld-value-displayed-only` → `declaredRules`

**Vị ngữ.** Với mỗi `PropertyValue` trong `Dataset`: nếu `value` có phần thập
phân, thì một cách in của nó phải xuất hiện trên trang. Được phép **thêm** số 0
ở cuối (`46` in thành `46.0`) và thêm dấu phân cách nghìn. **Không** được phép
bớt chữ số. Số nguyên nằm ngoài phạm vi luật.

**Vì sao số nguyên nằm ngoài, và đây là chỗ bản đầu tiên của luật quá rộng:**
trang in `$2.25 billion` cho `2249409000`. Chính sách `rounding.policy` của HQ
cho phép "một dạng đổi thang (nghìn/triệu/tỷ)". Bắt số nguyên phải xuất hiện
nguyên dạng là **đòi JSON-LD công bố dữ liệu kém chính xác hơn dữ liệu thật**.
Đổi thang không bịa ra chữ số nào; chỉ phần thập phân mới bịa được.

**Vector** (verdict đo, 3 accept / 3 reject) — trích:

| expect | value | trang in | lý do đo được |
|---|---|---|---|
| accept | `2249409000` | `$2.25 billion` | số nguyên — không có chữ số thập phân nào để bịa |
| accept | `46.9` | `46.9%` | trang có in `46.9` |
| reject | `46.02954943221133` | `46.0%` | không cách in nào của giá trị xuất hiện trên trang |
| reject | `"$372,100"` (chuỗi) | `$372,100` | `value` không phải số — schema.org đòi số để máy dùng được |

### 4.2 `jsonld-aggregate-declares-scope` → `provenBy` cho luật đang hở

HQ nêu ba luật không có `provenBy`. Luật này là một trong ba, và **nửa JSON-LD
của nó kiểm được từ xa** — nửa văn bản thì không, vì chỉ build của site mới
thấy văn bản.

**Vị ngữ.** `measurementTechnique` phải khớp đúng một trong hai hình dạng:

```
thô:  <nguồn> (<zip|county|state|metro|cbsa>-level)
gộp:  <phép tính> of <nguồn> across <N> <danh từ phạm vi>
```

Không có hình thứ ba. Từ vựng phép tính cố định
(`sum|total|median|mean|average|count|min|max|range|spread`) — nhận "bất kỳ
chuỗi nào có chữ" thì luật không từ chối được gì.

**Vector** (2 accept / 4 reject) — trích:

| expect | measurementTechnique | lý do đo được |
|---|---|---|
| accept | `sum of Census ACS5 (geographic mobility) across 256 ZIP codes` | gộp khai đủ: sum · 256 ZIP codes |
| accept | `Census ACS5 (housing & income) (zip-level)` | số thô, khai cấp đo |
| reject | `sum of Census ACS5 (geographic mobility)` | có phép tính, không có số lượng địa bàn |
| reject | `sum Census ACS5 across 256 ZIP codes` | có phép tính và số lượng, thiếu `of` nối sang nguồn |
| reject | `IRS SOI County Migration` | không cấp đo, không phép tính |
| reject | `` (rỗng) | trường trống |

**Kết quả trên publisher thật: 449/449 đạt.** Luật này đang chạy đúng ở
atmovingservices, và giờ có bằng chứng chạy thay vì chỉ được khai báo — với
điều kiện đọc kèm các ca reject ở trên, vì một luật chỉ từng pass thì không
phân biệt được với một luật không kiểm gì.

### 4.3 `sitemap-covers-indexable` → probe phía HQ, KHÔNG phải declaredRule

Cùng mô hình `requiredPages`: HQ gọi HTTP và tự kết luận, publisher không phải
cài gì.

**Vị ngữ.** Mọi URL nội bộ được link từ trang đã đọc, trả 200, `Content-Type:
text/html`, không có `noindex` → phải có trong sitemap.

Đặt ở đây chứ không đặt vào `declaredRules` vì **HQ có lợi ích trực tiếp**: đó
là mẫu số tỷ lệ index của chính HQ (§3.3). Một luật mà HQ vừa ra vừa là bên
hưởng thì phải là phép kiểm HQ tự chạy, không phải nghĩa vụ giao cho site rồi
tin báo cáo.

**Nên bê nguyên chi tiết `linkedFrom` từ `required-pages.ts` sang, và bê theo
chiều ngược lại**: `/moving-services/dc` cho thấy "có trong sitemap" và "người
đọc tới được" vẫn là hai câu hỏi khác nhau, kể cả với trang không phải trang
tin cậy.

---

## 5. Phần KHÔNG nên vào HQ — checklist publisher

Đúng ranh giới HQ nêu: đây là phần trình bày. Chúng có giá trị, nhưng nhét vào
endpoint hợp đồng sẽ tạo thêm luật khai báo không bằng chứng.

| # | Việc | Đo được ở atmovingservices |
|---|---|---|
| 1 | Canonical tự trỏ trên **mọi** trang, kể cả trang chủ, kể cả khi có query string | thiếu ở trang chủ |
| 2 | Xoá hoặc `noindex` nội dung giữ chỗ của CMS trước khi mở index | `/blog/hello-world` đang sống |
| 3 | `lastmod` riêng cho từng trang, để một trang đổi thì mốc của chính nó đổi | 190/194 dùng chung một mốc nội dung (KHÔNG phải giờ build — §3.4) |
| 4 | Mọi trang trong danh sách phân cấp phải được trang cha link tới | 24/26 hub bang |
| 5 | `Article`/`BlogPosting` cho bài viết; `Organization` có `logo`, `sameAs`, `contactPoint` | thiếu toàn bộ |
| 6 | `Dataset` có `license` + `temporalCoverage` | thiếu ở mọi Dataset |
| 7 | Favicon | không có |
| 8 | `og:image` nếu đã khai `twitter:card` | khai card, không có ảnh |
| 9 | Title ≤ ~60 ký tự — ưu tiên cắt tên thương hiệu, không cắt địa danh | 47/56 vượt |
| 10 | Ngân sách JS | ~600KB JS chưa nén cho trang không có ảnh nào, cộng GTM + beacon Cloudflare |
| 11 | Chính sách bot AI trong `robots.txt` | 9 user-agent bị chặn bằng khối Cloudflare mặc định |

**Về mục 11, cần một quyết định của người, không phải của session nào:** khối
`# BEGIN Cloudflare Managed content` đang chặn `GPTBot`, `ClaudeBot`, `CCBot`,
`Google-Extended`, `Bytespider`, `Amazonbot`, `Applebot-Extended`,
`meta-externalagent`, và khai `Content-Signal: search=yes, ai-train=no,
use=reference`. Nó **bật mặc định**, không ai trong dự án chọn nó. Với một site
mà toàn bộ luận điểm là "số liệu liên bang có nguồn, kiểm được" — tức đúng loại
nội dung máy trả lời hay trích — thì đây là quyết định chiến lược đang được
thừa hưởng trong im lặng. Ghi ra đây để nó được chọn, không phải để đổi.

**Không đo được trong session này:** Core Web Vitals ngoài thực địa (LCP/INP/CLS
của người dùng thật). Cần CrUX hoặc GSC. Con số 600KB là trọng lượng tải, không
phải trải nghiệm — đừng dùng nó thay cho field data.

---

## 6. Chỗ tôi kẹt

**Một chỉ số dẫn xuất không phân biệt được với một chỉ số thô, nhìn từ bên
ngoài.** `$71,674` là thương của hai chỉ số IRS. Trang nói phép chia đó ra cho
người đọc; `measurementTechnique` thì không (§3.6). Vị ngữ ở §4.2 **cho ca này
qua**, vì nó thấy `(county-level)` và không có gì trong JSON-LD cho biết con số
là dẫn xuất.

Bịt được, nhưng chỉ bằng cách mở rộng hợp đồng: bắt mọi chỉ số dẫn xuất khai
theo hình dạng gộp (`quotient of A and B across 1 county`). Đó là ràng buộc lên
cách site viết schema, và tôi không tự quyết — nên để nguyên và nói ra, thay vì
âm thầm nới vị ngữ cho có vẻ đủ.

Hai luật còn hở của HQ — `worded-proportion` và `no-supply-side-bridge` — là
luật văn bản. Session này không đụng tới chúng và không có gì đóng góp; chúng
thuộc phía QC Content.

---

### 6.1 Một đề xuất của tôi bị bác bằng docs, và bác đúng

`/blog/:slug` trả **200** cho slug không tồn tại (soft 404), kèm
`<meta name="robots" content="noindex">` mà `notFound()` tự chèn.

Tôi đề xuất chuyển phép kiểm tồn tại vào `proxy` — docs `not-found.md` của bản
Next đang cài chỉ thẳng lối đó: *"With Cache Components, every dynamic route
streams a static shell first, so run that check in proxy instead."* Và tôi bác
lý do ban đầu của Pubsite (danh sách slug gắn với build) vì hook publish đã tồn
tại, nên tập slug tươi được **lúc publish** chứ không phải lúc build.

Pubsite bỏ lý do đó, rồi đưa một lý do khác từ docs `proxy` của **cùng bản
Next**:

> Using fetch with `options.cache`, `options.next.revalidate`, or
> `options.next.tags`, has no effect in Proxy.

Đó là lý do thật, và nó giết cả hai biến thể của đề xuất: mỗi slug lạ trả tiền
một round-trip đầy đủ tới WordPress, trên đường chặn **mọi** request blog, và
không cách nào cache. Manifest thị trường chạy được trong proxy chính vì nó là
**import tĩnh** — không fetch. Một tập slug làm mới lúc publish thì theo định
nghĩa không thể là import tĩnh. Hai yêu cầu "đọc được trong proxy mà không
fetch" và "đổi được giữa hai lần build" mâu thuẫn nhau trong kiến trúc này.

Giữ soft 404 là đúng, và thiệt hại còn lại hẹp: không phải bị index (đã
`noindex`), mà là một dòng Soft 404 trong Search Console cộng crawl budget tiêu
vào slug chết.

**Hai điều kiện vẫn đứng nếu ràng buộc đổi** — ghi lại để người sau không phải
dựng lại: fail **open** với mọi lỗi/timeout/không-đọc-được-danh-sách, và chỉ trả
404 khi có **bằng chứng dương tính** rằng slug không tồn tại. Không bao giờ 404
vì "không biết" — nếu không, một lần WordPress chập chờn biến bài thật thành 404
hàng loạt, đúng thiệt hại đang tránh, chỉ to hơn.

### 6.2 Giới hạn của vị trí, không phải của phép kiểm

`verify:rendered` phía site bắt được một trang thừa kế title của layout gốc;
audit này bỏ lọt cho tới khi **hai** trang cùng hỏng (`duplicate-title`). Lý do
không phải phép kiểm dở hơn: phía site **biết trang nào lẽ ra phải tự khai
metadata**, còn từ ngoài chỉ đọc được HTML.

Thứ gần nhất làm được từ ngoài — và đã thêm vào audit — là so title với title
trang chủ (`title-inherited-from-home`). Nó bắt được ca một-trang. Nó **không**
phân biệt được "thừa kế" với "cố ý đặt giống", nên nó là cảnh báo.

Nguyên tắc rút ra, đáng hơn phép kiểm: hai bộ kiểm chỉ xác nhận lẫn nhau khi
chúng đứng ở **hai vị trí khác nhau** — một bên crawl HTTP từ ngoài, một bên đọc
file build ra. Nếu cả hai cùng crawl live thì chúng mù cùng một chỗ, và sự trùng
khớp không nói lên điều gì.

---

## 7. Phản hồi về phân loại DataForSEO OnPage

HQ mời phản hồi `lib/dataforseo/on-page.ts`. Hai chỗ đo được:

**a. `no_favicon` bị phân loại hai lần, hai mức khác nhau.** Map hiện có
`no_favicon: warning` và `no_favicon_check: info` — cùng một sự kiện. Site này
thật sự không có favicon, nên nó là ca sống: hoặc UI hiện hai dòng cho một sự
việc, hoặc một trong hai key **không bao giờ nổ** — mà nhánh không bao giờ nổ
thì xoá đi cũng không ai biết, đúng cảnh báo HQ vừa trả bằng máu.

**b. `canonical` nằm trong `NEUTRAL_CHECKS`, nên lỗi thật của site này vô hình
với OnPage.** `canonical` là **số trang CÓ** canonical — một phép đếm, và một
phép đếm không có mẫu số thì không nói được điều gì. Trang chủ thiếu canonical
sẽ chỉ làm con số đó nhỏ hơn tổng số trang crawl, và không có gì trong UI so
hai số đó. Đề nghị: đổi thành một dòng dẫn xuất `canonical < crawled_pages` →
issue, hoặc giữ neutral và ghi rõ rằng thiếu canonical phải bắt bằng
`scripts/audit-technical-seo.ts`, đừng để nó rơi vào khoảng giữa.

**c. Ghi nhận, không phải lỗi:** OnPage của DataForSEO **không kiểm structured
data**. Toàn bộ §3.1, §3.5, §3.6 nằm ngoài tầm nó. Nếu HQ muốn schema được
theo dõi thì phải là phép kiểm của chính HQ — đó là lý do
`scripts/audit-technical-seo.ts` tồn tại.

---

## 8. Quy trình: worktree + PR cho mọi session

Chốt 2026-09-10 giữa session này và HQ, và chốt bằng **bằng chứng trong ngày**,
không phải bằng nguyên tắc:

| Chuyện xảy ra | Hệ thống đã dựa vào điều gì |
|---|---|
| `git add -A` cuốn file đang dở của **hai** session khác vào commit của HQ, rồi push lên main | mỗi người nhớ chỉ add file của mình |
| `eslint` chạy trên vài file thay vì `eslint .` — cổng tại chỗ xanh, cổng CI đỏ | mỗi người nhớ chạy đúng phạm vi |
| `a0d76c7`: `tsc` báo lỗi, commit vẫn push vì lệnh git ở dòng khác và không có `set -e` | mỗi người nhớ đọc output |

Cả ba đều là "hệ thống dựa vào việc mỗi người nhớ làm đúng". Với một session thì
cách đó hỏng thỉnh thoảng; với bốn session thì nó hỏng theo lịch.

**Quy tắc:**

1. Mỗi session làm trong **git worktree riêng** (`.claude/worktrees/<tên>`).
   `git add -A` của session khác không nhìn thấy file ở đó.
2. Vào main qua **PR**, không push thẳng.
3. `.github/workflows/pr.yml` chạy trên mọi PR: `prisma generate` → `tsc
   --noEmit` → `eslint .` (toàn repo, không phải file vừa sửa) →
   `verify-technical-rules.ts`.

Cổng PR **cố ý không** dựng Postgres, không `next build`, không chạy mấy script
đọc dữ liệu thật — chúng cần DB có dữ liệu, và chạy với DB rỗng sẽ báo xanh
trong khi không kiểm gì. Pipeline đầy đủ vẫn chạy khi commit vào main.

Chi phí đo được: một lượt CI khoảng hai phút. So với một giờ để phát hiện mình
đã cuốn file của người khác vào commit.

**Còn treo:** `verify-content-rules.ts` sẽ vào cổng PR (cần thêm service
Postgres + `prisma migrate deploy`), nhưng **chỉ sau khi `ffcd3d5` lên main**.
HQ đo thật với DB rỗng và tìm ra 1 trong 10 phép của script đó **đạt rỗng**: "✓
0 chỉ số, mỗi chỉ số đúng resolution" — đúng về mặt logic, vì nó nói về tập
rỗng, và đọc y hệt một phép vừa xác nhận điều gì đó. Đưa vào trước bản sửa thì
một PR xanh sẽ đọc như "đã kiểm resolution của chỉ số" trong khi nó chưa hỏi chỉ
số nào.

---

## 9. Chạy lại

```bash
tsx scripts/verify-technical-rules.ts
```
Chạy 12 vector qua vị ngữ thật; đổ nếu một luật không còn cả accept lẫn reject,
nếu một nhánh không vector nào chạm tới, hoặc nếu một validator "accept mọi
thứ" lọt qua được. Không gọi mạng.

```bash
tsx scripts/audit-technical-seo.ts https://atmovingservices.com --sample 40 --json audit.json
```
Đo site thật. Exit code 1 khi có lỗi, nên publisher gọi thẳng được trong CI.

**Một ghi chú về chính script này, vì nó là ca minh hoạ đúng thứ HQ cảnh báo:**
bản đầu của `checkDisplayedOnlyValue` sinh mọi độ chính xác ngắn hơn, nên nó
chấp nhận `15.77459714851814` khi trang in `15.8` — tức chấp nhận đúng ca nó
được viết ra để từ chối. 11 vector vẫn xanh. Thứ bắt được là **phép kiểm độ phủ
nhánh**: nhánh "reject — chữ số vượt mức đã in" không còn vector nào chạm tới,
vì không ca nào còn reject được nữa. Ca test có tồn tại; nhánh thì không ai
chạy tới.
