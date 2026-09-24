/**
 * Xuất dữ liệu một publisher trục THỰC THỂ ra thư mục data/sites/<host>/.
 *
 *     npm run entity:export -- bongda.invalid ../../publisher/atmovingservices
 *
 * ═══ VÌ SAO TỒN TẠI BÊN CẠNH ĐƯỜNG API ═══
 *
 * Đường chính thức là publisher gọi `GET /api/v1/niches/{vertical}/entities`
 * và `/entity-spec` bằng khoá của chính nó. Đường đó cần MỘT hàng `Website`
 * trong HQ, và `Website` đòi `gscPropertyUrl` cùng `ga4PropertyId` — hai thứ
 * chỉ tồn tại khi đã có domain thật và đã xác minh sở hữu nó.
 *
 * Domain của site bóng đá CHƯA được chọn (xem `site.json`). Nên đường API bị
 * chặn bởi một quyết định kinh doanh, không phải bởi kỹ thuật.
 *
 * Script này đi vòng qua đúng chỗ đó và KHÔNG đi vòng qua chỗ nào khác: dữ
 * liệu vẫn là `EntityIdentity` và `entitySpecFor` — cùng nguồn mà route API
 * đọc, cùng hình dạng route API trả. Đổi sang `npm run hq:entities` khi có
 * domain là đổi đường vận chuyển, không đổi nội dung.
 *
 * Không dùng nó để sửa dữ liệu. `football:sync` vẫn là chỗ duy nhất ghi vào
 * `EntityIdentity`; script này chỉ đọc.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { entitySpecFor } from "@/lib/content-spec/entity-spec";
import { FOOTBALL_VERTICAL, axesFor } from "@/lib/page-axis/axes";
import { buildEntityFactSet, loadSeasons } from "@/lib/ai/entity-generate";

async function main(): Promise<void> {
  const [host, publisherRoot] = process.argv.slice(2);
  if (!host || !publisherRoot) {
    console.error("Dùng: npm run entity:export -- <host> <đường dẫn kho publisher>");
    process.exit(1);
  }

  const vertical = FOOTBALL_VERTICAL;
  const axes = axesFor(vertical);
  const spec = entitySpecFor(vertical);
  if (!spec || axes.length === 0) {
    console.error(`Nghề "${vertical}" chưa có đặc tả hoặc chưa khai axis.`);
    process.exit(1);
  }

  const rows = await prisma.entityIdentity.findMany({
    where: { vertical },
    select: { axis: true, key: true, parentKey: true, displayName: true },
    orderBy: [{ axis: "asc" }, { key: "asc" }],
  });
  if (rows.length === 0) {
    console.error("Không hàng EntityIdentity nào. Chạy `npm run football:sync` trước.");
    process.exit(1);
  }

  /**
   * `hasContent` — trang này có SỐ để nói hay không.
   *
   * Danh tính có từ đầu mùa cho MỌI cặp đối đầu, nhưng 626/876 cặp chưa gặp
   * nhau, và trang của chúng gọi `notFound()` đúng theo thiết kế. Đổ thẳng
   * `entities.json` vào sitemap là nộp 626 URL trả 404 — Search Console đọc
   * đó là site tự khai những trang không tồn tại.
   *
   * Cờ phải tính Ở ĐÂY chứ không bên publisher: chỉ HQ có tập chỉ số. Và nó
   * là `facts.length > 0`, không phải một luật riêng — `fixtureFacts` đã trả
   * `[]` khi hai đội chưa gặp nhau, nên hỏi "có fact không" là hỏi đúng câu
   * mà trang sẽ tự hỏi lúc render.
   *
   * NẠP MÙA GIẢI MỘT LẦN cho cả lô: `buildEntityFactSet` gọi mạng một lần
   * mỗi khoá, nên 977 khoá là ~1.500 request tới GitHub cho đúng năm kết
   * quả. `loadSeasons()` nạp năm giải rồi truyền xuống.
   */
  const seasons = await loadSeasons();
  const withContent = [];
  for (const r of rows) {
    const fs = await buildEntityFactSet(vertical, r.axis, r.key, new Date(), seasons);
    withContent.push({ ...r, hasContent: (fs?.facts.length ?? 0) > 0 });
  }
  const contentCount = withContent.filter((r) => r.hasContent).length;

  const dir = path.resolve(publisherRoot, "data", "sites", host);
  await mkdir(dir, { recursive: true });

  const entities = {
    vertical,
    // Thời điểm XUẤT, không phải thời điểm dữ liệu bóng đá được đo. Hai thứ
    // khác nhau: độ trễ dữ liệu do trang tự đọc lúc render (stalenessDays),
    // còn con số này chỉ nói manifest kéo về lúc nào.
    generatedAt: new Date().toISOString(),
    axes: axes.map((a) => ({ axis: a.axis, label: a.label, parentAxis: a.parentAxis })),
    counts: Object.fromEntries(axes.map((a) => [a.axis, rows.filter((r) => r.axis === a.axis).length])),
    entities: withContent,
  };

  await writeFile(path.join(dir, "entities.json"), JSON.stringify(entities, null, 2) + "\n", "utf-8");
  await writeFile(
    path.join(dir, "entity-spec.json"),
    JSON.stringify({ axes: entities.axes, ...spec }, null, 2) + "\n",
    "utf-8"
  );

  console.log(`✓ ${dir}`);
  console.log(`  entities.json     ${rows.length} trang — ${JSON.stringify(entities.counts)}`);
  console.log(`  hasContent        ${contentCount}/${rows.length} có số để nói; ${rows.length - contentCount} trang sẽ 404 và KHÔNG vào sitemap`);
  console.log(`  entity-spec.json  ${spec.pages.length} loại trang`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
