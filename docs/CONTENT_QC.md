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
`acceptedAnswer` của JSON-LD FAQ.

HQ tự tái hiện, truy ra nguyên nhân là commit `4bf32ca` của chính HQ (đổi nghĩa
trường `display` công khai mà không bump version), và sửa ở `7e5d191` bằng cách
tách `display` / `displayNumber`.

Đã đo lại sau khi bản sửa lên sóng: **14/14 trang zip sạch**.

Bài học ghi lại cho publisher mới: một trường trong `/api/v1` đổi nghĩa mà không
đổi version thì phía tiêu thụ không có cách nào biết. Dấu vết đọc được ngay
trong câu — một slot bị đôi đơn vị còn slot bên cạnh thì không.

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
- **`assertScannerWorks()` của `scan-generated-copy.ts` chưa chạy lại được sau
  khi tách module** — script đó cần DB, và session này không có tunnel. `tsc
  --noEmit` sạch, và phần tách là thuần cơ học (di chuyển + thêm `export`, không
  sửa một ký tự regex nào), nhưng self-test của nó vẫn nên được chạy một lần ở
  nơi có DB trước khi tin.
