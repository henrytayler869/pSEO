# QC Content — quy trình, và kết quả lần chạy đầu

Session QC Content, 2026-09-10. Publisher được QC: **atmovingservices.com**,
crawl **toàn bộ 192 URL trong sitemap** (không phải mẫu).

Mọi con số trong tài liệu này tái lập được bằng lệnh ở mục cuối. Một phát hiện
không chạy lại được thì không nằm ở đây.

---

## Điều lần QC này tìm ra, và nó đổi cách nghĩ về luật nội dung

Bốn nơi trong hệ thống mang luật nội dung:

| nơi | soi cái gì |
|---|---|
| `lib/ai/generate.ts` | prompt — ràng buộc model TRƯỚC khi nó viết |
| `lib/ai/validate.ts` | chuỗi model vừa trả về |
| `scripts/scan-generated-copy.ts` | các generation đã lưu trong DB của HQ |
| `lib/content-rules/registry.ts` | hợp đồng phát cho publisher |

Cả bốn soi cùng một thứ: **văn do model sinh**.

Nhưng một trang publish ra phần lớn KHÔNG phải văn model sinh. Nó là
**template** — câu do code của site viết, nối quanh các con số. Văn template
không đi qua model, nên không đi qua bất cứ chỗ nào biết tới luật.

Đo được trên 192 trang: **369 câu vi phạm `no-supply-side-bridge`**, thuộc **9
template**, lặp 127 / 97 / 57 / 44 / 16 / 13 / 12 lần. Không câu nào từng đi qua
`validateGeneratedText()`. Nguyên văn một câu, xuất hiện y hệt trên 97 trang:

> "Most moves into Duluth, GA started nearby, which is local-crew work: hourly
> rates, same-day jobs, and no long-haul logistics."

Rule 9 trong `lib/ai/generate.ts` cấm đúng hình dạng đó bằng chữ: *"Never follow
ANY figure with 'so', 'which means' … and then a statement about what the local
businesses in your trade are like, **or about what the typical local job
involves**."*

Luật không hở vì thiếu vector. Nó hở vì **đối tượng nó soi không phải thứ được
publish**. `declaredRules` ghi `enforcedBy: "lib/ai/generate.ts"` cho luật này —
tức luật sống trong prompt, và prompt chỉ ràng buộc được chuỗi model trả về.

**Hệ quả cho publisher mới:** một luật nội dung chỉ được coi là đang chạy khi có
thứ gì đó soi HTML ĐÃ RENDER. Chạy trên chuỗi trước khi render là chạy trên một
tài liệu không ai đọc.

---

## A. Luật đề xuất cho HQ — `rendered-supply-side-bridge`

Kiểm được từ xa, cùng mô hình `lib/publisher/required-pages.ts`: nội dung này
công khai, HQ chỉ cần hỏi site. Publisher mới thừa hưởng phép kiểm mà không phải
cài gì.

**Vị ngữ** (`isSupplySideBridge()` trong `scripts/scan-rendered-content.ts`) —
một câu bị TỪ CHỐI khi cả ba đúng:

1. **ANTECEDENT** — phần trước connector có một đại lượng đo (con số, hoặc
   `most / majority / more…than / close to even / typical / median / rate /
   balance / arrivals / departures / moves / migration`).
2. **CONNECTOR** — `so / therefore / meaning / that means / which is / which
   means / which in practice means`, hoặc dấu gạch dài.
3. **SUPPLY** — phần sau connector KHẲNG ĐỊNH về phía cung: `jobs / workload /
   logistics / bookings / capacity`, `demand splits|is|runs|means`, `hourly|flat
   rates`, `crew(s) is|are|work…|handle`, `movers|companies|providers|contractors
   + handle|are|tend|book|charge|do`, `inbound|outbound work`.

…và KHÔNG đúng khi câu chứa lời khuyên hướng người đọc (`ask / confirm / check /
point out / mention / say / tell / walk / compare / call / choose / when you /
your move / …`). Đây là lối thoát mà rule 8 nêu đích danh: *"Homes date from
1966, so **ask** how the crew protects narrow stairways"* là hợp lệ.

**Vector**: 10 ca, **5 reject / 5 accept**, mọi câu là NGUYÊN VĂN từ site (không
câu nào viết ra để test). Verdict do chạy hàm mà có, không khai bằng tay.

**Nhánh im đã bị ép nổ.** Hai nhánh thu hẹp (`ANTECEDENT`, `READER_ADVICE`) được
đột biến từng cái một; mỗi lần phải có vector đổi kết quả, nếu không self-test
thất bại. `SUPPLY_ASSERTION` cố ý KHÔNG đột biến: nó là nhánh mở rộng, vô hiệu nó
thì mọi vector reject đều đổi và phép thử luôn xanh mà không chứng minh gì.

```
Cả 10 vector khớp (5 reject / 5 accept).
Đột biến: vô hiệu ANTECEDENT làm 1 vector đổi kết quả; vô hiệu READER_ADVICE
làm 1 vector đổi kết quả — cả hai nhánh thu hẹp đều chạy thật.
```

**Vì sao không mở rộng `migration_bridge` có sẵn:** cái đó cố ý chỉ soi số DI CƯ
(đúng phạm vi rule 9 cấm tuyệt đối) và đã bị thu hẹp một lần sau khi báo nhầm
một câu rule 8 cho phép. Luật mới soi hình dạng "đại lượng đo → khẳng định về
công việc" trên MỌI loại figure, và chỉ chạy trên văn đã render.

---

## B. Đã sửa trong lúc QC — đơn vị bị in hai lần

Đo lần đầu: **"households households" 504 lần trên 126/192 trang**, có cả trong
`acceptedAnswer` của JSON-LD FAQ. Đo lại sau đó: **14/14 trang zip sạch**.

Nguyên nhân là commit `4bf32ca` của HQ — đổi `formatForPrompt()` để trường
`display` trên `/api/v1` mang luôn đơn vị, không bump version, không báo phía
tiêu thụ. Template của site nối thêm `" households"` như nó vẫn làm suốt.

**Cái sửa được site KHÔNG phải bản sửa của HQ.** Bản đầu tiên của tài liệu này
ghi "đo lại sau khi 7e5d191 lên sóng", và đó là một quy kết sai — hai phép đo
cách nhau vài giờ, ở giữa có một commit của HQ, và tôi nối chúng lại thành nhân
quả mà không có bằng chứng nào cho mắt xích ở giữa.

Ba thứ bác bỏ nó, xếp theo độ chắc:

1. **`display` vẫn mang đơn vị sau `7e5d191`.** Commit đó THÊM `displayNumber`
   và `unitWord` chứ không đổi `display` — đọc được ở
   `app/api/v1/niches/[vertical]/markets/[zip]/route.ts:149`. Một consumer vẫn
   nối `" households"` vào `display` thì vẫn in đôi, dù commit ấy có deploy hay
   không. Bản sửa của HQ một mình KHÔNG thể làm site sạch.
2. **Phía site đã tự sửa**, bằng một hàm `withUnit()` chỉ nối đơn vị khi chuỗi
   chưa có — nên nó đúng với cả `display` cũ lẫn mới, và không phụ thuộc HQ
   deploy gì. (Báo cáo từ session HQ, đọc trong repo của site; session này không
   có quyền vào máy đó để tự xác minh.)
3. `7e5d191` **trượt CI** (`gh run list`: failure, 07:53Z). Lý do yếu nhất trong
   ba, và đáng ghi lại vì sao nó yếu: commit kế tiếp `3ac0623` CI XANH lúc
   08:07Z, mà `3ac0623` là con của `7e5d191` — nên "commit này trượt CI" không
   kết luận được rằng code của nó chưa lên sóng.

Hai bài học, và cái thứ hai đắt hơn:

- Một trường trong `/api/v1` đổi nghĩa mà không đổi version thì phía tiêu thụ
  không có cách nào biết. Dấu vết đọc được ngay trong câu — một slot bị đôi đơn
  vị còn slot bên cạnh thì không.
- **Một phép đo đúng vẫn có thể mang một quy kết sai.** "Đo trước, sửa, đo sau,
  sạch" đọc như một chuỗi nhân quả, và nó không phải — trong một dự án có ba
  session cùng sửa một hệ thống, giữa hai phép đo luôn có nhiều hơn một thay đổi.
  Trước khi gắn kết quả vào một commit, phải kiểm được rằng commit đó chạm tới
  đúng thứ đã đổi.

---

## B2. Trang cụm — và câu trả lời cho `aggregate-must-declare-scope`

QC riêng **31/31 trang cụm** (crawl tươi, không dùng lại corpus). Đây là loại
trang duy nhất gộp dữ liệu qua nhiều địa bàn, tức nơi luật
`aggregate-must-declare-scope` thật sự có bề mặt — và luật đó là một trong ba
luật HQ chưa có `provenBy`.

**Phần "gộp" của luật: KHÔNG bị vi phạm, vì site cố ý không gộp.** Trang cụm
tách riêng từng county thay vì cộng lại — H2 đổi thành "Migration, county by
county" đúng trên 5 trang đa-county, mỗi county ghi rõ bao nhiêu ZIP thuộc về nó
("Harris County — 7 of these ZIP codes"), phép tính dẫn xuất in kèm ngay cạnh
("Calculated: Income arriving with inbound households ÷ Moved in over the year"),
và trang nói thẳng *"No substitute or county average is shown in its place."*
Cộng một metric COUNTY theo từng ZIP nhân lên tới 13.07x; site này không làm phép
cộng đó ở đâu cả.

**Nhưng có một con số dẫn xuất khác, và nó khai sai phạm vi.** Trang cụm in tỷ số
max/min qua các ZIP: *"a 1.77 × spread across one county"*. Tỷ số đúng. Mệnh đề
phạm vi thì sai — trang Houston tự khai ở đoạn mở đầu rằng nó trải **ba** county,
rồi năm dòng dưới nói con số ấy trải "one county".

Đo được: **4 trang, 18 câu** (`tx/houston` 3 county / 5 câu, `ca/lancaster`,
`nc/charlotte`, `va/virginia-beach` 2 county). `ga/cumming` cũng 2 county nhưng
không in dòng spread nào nên không dính.

Đây không phải lỗi chính tả. Mệnh đề phạm vi là thứ **duy nhất** cho người đọc
kiểm được con số: "1.77× across one county" mời hiểu rằng chênh lệch ấy tồn tại
bên trong một thị trường; "across three counties" nói một điều khác hẳn — rằng nó
tồn tại giữa ba thị trường bị gộp vào một trang. Cùng một con số, hai kết luận
trái ngược, và phần quyết định kết luận là phần bị in sai.

Và nó là bug cục bộ chứ không phải thiếu sót thiết kế: logic đa-county ĐÃ tồn tại
(H2 đổi, câu "They span N counties" đổi) — chỉ riêng chuỗi "across one county" bị
bỏ sót.

**Luật đề xuất: `cluster-scope-count-mismatch`** — HQ kiểm từ xa mà không cần dữ
liệu nào bên ngoài, vì **trang tự mâu thuẫn với chính nó**. Nó khai số county ở
một chỗ và phủ nhận ở chỗ khác; không phép đo nào ngoài trang tham gia vào kết
luận. Vị ngữ ở `findScopeCountMismatches()`. 5 vector, 2 reject / 3 accept — ba ca
đầu nguyên văn từ site, **hai ca cuối đánh dấu DỰNG** vì hình dạng đúng (cụm đa
county khai đúng số) chưa tồn tại trên site, và nếu không dựng thì hai nhánh thu
hẹp của luật không ca nào ép chạy tới.

Hai phát hiện phụ trên cùng 31 trang:

- **`rendered-supply-side-bridge` không bắt gì trên trang cụm.** Cả 9 template vi
  phạm đều nằm trên trang ZIP. Một con số zero có nghĩa ở đây, vì luật có bề mặt:
  trang cụm cũng đầy figure và cũng có connector.
- **0/31 trang cụm có `Dataset` hoặc `FAQPage`**, trong khi 127/127 trang ZIP có
  cả hai. JSON-LD của chúng chỉ có `Organization, WebSite, WebPage,
  BreadcrumbList`. Thuộc vế publisher, ghi ở mục C.

---

## C. Thuộc checklist publisher, KHÔNG phải hợp đồng HQ

HQ giữ hợp đồng (luật phải giống nhau ở mọi publisher). Ba mục dưới đây là
TRÌNH BÀY của một site cụ thể — ghi lại để publisher mới không lặp, không đề
xuất đưa vào `declaredRules`.

**C1. 10 link nội bộ trỏ tới 404.** Trên `/local-moving` và
`/long-distance-moving`, bảng "top ZIP" sinh link theo mẫu `{state}/{city}-{zip}`
mà không hỏi ZIP đó có trang riêng hay không. Mọi ZIP thuộc một thành phố
**cụm** (Chicago, Houston, Washington DC, Charlotte, North Las Vegas) không có
trang riêng — nên link chết:

- `/local-moving`: **8/12 hàng** trỏ 404
- `/long-distance-moving`: **4/12 hàng** trỏ 404

Đây là mặt còn thiếu của `cluster-no-zip-anchor`: luật đó nói về NỘI DUNG trên
trang cụm, và không ai nói gì về việc LINK tới một ZIP đã bị gộp vào cụm.

**C2. Bài WordPress mặc định đang được index.** `/blog/hello-world` trả 200,
`meta robots: index, follow`, canonical tự trỏ, meta description nguyên văn
*"Welcome to WordPress. This is your first post. Edit or delete it, then start
writing!"*. `/blog` chỉ có 40 từ và không có JSON-LD, trong khi mọi trang khác
đều có. Bài này KHÔNG nằm trong sitemap nhưng được link từ `/blog`.

**C0. Trang cụm thiếu `Dataset` và `FAQPage`.** 0/31, trong khi 127/127 trang ZIP
có cả hai. Có thể là chủ ý (một trang gộp 23 ZIP không mô tả gọn thành một
dataset), nhưng nếu vậy thì đó là một quyết định chưa được ghi ở đâu — và
`audit-technical-seo.ts` có nhánh `dataset-required` sẽ đọc nó như thiếu sót.

**C3. Telemetry SEO in cho người đọc.** `seo_leak` (pattern đã có sẵn của HQ)
bắt **18 template / 287 câu / 159 trang** khi chạy trên HTML render. Đáng lo
nhất: *"Keyword difficulty for the term is 0 — measured, not missing: no
established page currently competes for it."* trên **109 trang**. Người đi thuê
xe chuyển nhà không dùng độ khó từ khoá; in nó ra là tự khai trang do máy dựng.

Lưu ý trung thực: không phải cả 18 template đều là lỗi. Câu giải thích phương
pháp trên `/data` và trang state (*"ZIP codes … not part of a shared-keyword
group get a page of their own"*) là minh bạch có chủ đích, và một bộ quét bắt cả
chúng sẽ dạy người đọc lướt.

---

## D. Hai luật hiện có nên SỬA, không phải thêm luật mới

**D1. `off_trade` báo nhầm trang pháp lý.** `moving-services` có
`alsoOffLimits: ["warrant(y|ies)", …]`, nên tiêu đề **"No warranty"** trên
`/terms` bị tính là viết sang nghề khác. Một trang điều khoản BẮT BUỘC phải nói
"no warranty" — và `requiredPages` của chính HQ đòi site phải có trang đó. Hai
luật của HQ đang mâu thuẫn nhau trên cùng một trang. Đề xuất: `off_trade` không
chạy trên các path trong `requiredPages`.

**D2. `migration_bridge` sinh nhiễu khi chạy trên template.** Trên văn render nó
bắt 32 câu, phần lớn là câu giải thích phương pháp (*"Household migration counts
come from IRS county-level data, so ZIP codes sharing a county share those
figures"*) — đúng, minh bạch, và không treo khẳng định nào lên con số. Regex đó
được hiệu chỉnh cho văn model sinh; đừng đọc kết quả của nó trên template như
đọc trên generation.

---

## Chạy lại

```bash
npx tsx scripts/scan-rendered-content.ts --self-test moving-services
```

```bash
npx tsx scripts/scan-rendered-content.ts https://atmovingservices.com moving-services --sample 40
```

`--from-dir <thư mục>` quét HTML đã tải sẵn, để tái lập một kết quả cũ mà không
phụ thuộc trạng thái site lúc này. Exit code 1 khi có câu bị bắt hoặc khi tự kiểm
thất bại — gọi thẳng được từ CI của publisher.

Bộ mẫu dùng chung nằm ở `lib/content-rules/copy-patterns.ts`, tách ra khỏi
`scripts/scan-generated-copy.ts` ngày 2026-09-10 vì giờ có hai nơi cần chạy cùng
một bộ regex. Chép sang nơi thứ hai là tạo bản sao thứ ba của một luật.

---

## Chỗ chưa làm được

- **Không đo được hiệu quả tìm kiếm.** Không có quyền GSC/GA4 trong session này,
  nên mọi kết luận ở đây là về NỘI DUNG, không phải về thứ hạng hay lưu lượng.
- **Luật mới mới chỉ chứng minh cho `moving-services`.** `SUPPLY_ASSERTION` chứa
  danh từ chỉ công việc chung (`jobs`, `crew`, `logistics`) nên nhiều khả năng
  chuyển được sang ngành khác, nhưng chưa có trang publish nào của ngành khác để
  đo. Đừng ghi nó là đã chứng minh cho 13 nghề.
Việc từng treo ở đây — self-test của `scan-generated-copy.ts` sau khi tách
module — **đã đóng**. Session HQ chạy trên máy có tunnel DB, và xác minh rằng bản
được chạy đúng là bản đã tách (`scan-generated-copy.ts:26` import từ
`copy-patterns.ts`, `git diff HEAD` trên hai file rỗng):

```
assertScannerWorks(moving-services)  qua
bề mặt: seo_leak 148 · off_trade 148 · migration_bridge 147 · supply_side_claim 148
148/148 đoạn sạch cả 4 mẫu, 0 lần khớp
```

Dòng "bề mặt" đáng đọc kỹ hơn dòng kết quả: **cả bốn mẫu đều có bề mặt khác
rỗng**. "0 lần khớp" trên một mẫu có bề mặt 0 là con số vô nghĩa — nó không phân
biệt được "đã kiểm và sạch" với "chưa từng có gì để kiểm". Ở đây không phải vậy.
