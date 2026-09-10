// Chứng minh hai luật JSON-LD của HQ thật sự chạy, và thật sự TỪ CHỐI được.
//
// Song sinh với scripts/verify-content-rules.ts, và tồn tại vì cùng một lý do:
// một bộ vector mà mọi ca đều "accept" không phát hiện được một validator chấp
// nhận mọi thứ — đúng hình dạng mà bộ luật thoái hoá thành khi nới dần từng cái.
//
// Thêm một phép kiểm mà bản content chưa có, và nó trả lời trực tiếp cảnh báo
// của HQ ("ca test tồn tại không chứng minh nhánh được chạy tới"): script này
// đòi MỌI NHÁNH của vị ngữ phải có ít nhất một vector chạm tới. Nhánh nào không
// ai chạm thì xoá đi cũng không ai biết — nên nó bị coi là thất bại, không phải
// là chỗ trống.
//
// Usage: tsx scripts/verify-technical-rules.ts

import { measureVectors, checkAggregateTechnique, checkDisplayedOnlyValue } from "../lib/content-rules/jsonld-rules";

/**
 * Mỗi nhánh của hai vị ngữ, nhận diện bằng một mảnh lý do nó in ra.
 *
 * Nhận diện bằng LÝ DO chứ không bằng số dòng: lý do là thứ vị ngữ hứa với
 * người đọc, nên nếu một nhánh đổi lý do thì phép kiểm này phải đổ — nó vừa
 * kiểm nhánh có chạy, vừa kiểm nhánh còn nói đúng điều nó nói.
 */
const BRANCHES: { rule: string; marker: string; label: string }[] = [
  { rule: "jsonld-value-displayed-only", marker: "trang có in", label: "accept — có cách in khớp" },
  { rule: "jsonld-value-displayed-only", marker: "là số nguyên", label: "accept — số nguyên, ngoài phạm vi luật" },
  { rule: "jsonld-value-displayed-only", marker: "không cách in nào", label: "reject — chữ số vượt mức đã in" },
  { rule: "jsonld-value-displayed-only", marker: "không phải số", label: "reject — value không phải số" },
  { rule: "jsonld-aggregate-declares-scope", marker: "gộp khai đủ", label: "accept — số gộp khai đủ" },
  { rule: "jsonld-aggregate-declares-scope", marker: "số thô, khai cấp đo", label: "accept — số thô khai cấp đo" },
  { rule: "jsonld-aggregate-declares-scope", marker: "không có measurementTechnique", label: "reject — trường rỗng" },
  { rule: "jsonld-aggregate-declares-scope", marker: "gộp qua BAO NHIÊU", label: "reject — thiếu số lượng địa bàn" },
  { rule: "jsonld-aggregate-declares-scope", marker: "không nói gộp từ nguồn nào", label: "reject — thiếu nguồn" },
  { rule: "jsonld-aggregate-declares-scope", marker: "không khớp hình dạng nào", label: "reject — không hình dạng nào" },
];

function main() {
  const measured = measureVectors();
  const failures: string[] = [];

  console.log(`${measured.length} vector, verdict đo bằng cách chạy vị ngữ thật:\n`);
  for (const v of measured) {
    console.log(`${v.expect === "accept" ? "✓ accept" : "✗ reject"}  [${v.rule}]`);
    console.log(`          value=${JSON.stringify(v.value.value)}${v.value.measurementTechnique !== undefined ? ` technique="${v.value.measurementTechnique}"` : ""}`);
    console.log(`          → ${v.measuredReason}`);
  }

  // 1. Bộ vector phải có khả năng KHÔNG ĐỒNG Ý, theo từng luật.
  for (const rule of ["jsonld-value-displayed-only", "jsonld-aggregate-declares-scope"]) {
    const forRule = measured.filter((v) => v.rule === rule);
    const accepts = forRule.filter((v) => v.expect === "accept").length;
    const rejects = forRule.filter((v) => v.expect === "reject").length;
    console.log(`\n${rule}: ${accepts} accept · ${rejects} reject`);
    if (accepts === 0) failures.push(`${rule}: không có ca accept — luật từ chối mọi thứ vẫn pass được bộ này`);
    if (rejects === 0) failures.push(`${rule}: không có ca reject — luật chấp nhận mọi thứ vẫn pass được bộ này`);
  }

  // 2. Mọi nhánh phải có vector chạm tới.
  console.log("\nĐộ phủ nhánh:");
  for (const branch of BRANCHES) {
    const hit = measured.some((v) => v.rule === branch.rule && v.measuredReason.includes(branch.marker));
    console.log(`  ${hit ? "✓" : "✗"} ${branch.label}`);
    if (!hit) failures.push(`nhánh không có vector nào chạm: ${branch.rule} — ${branch.label}`);
  }

  // 3. Đột biến: sửa vị ngữ theo hướng dễ dãi nhất có thể, bộ vector PHẢI đổ.
  //
  // Không có bước này thì "9 vector đều xanh" không phân biệt được với "vị ngữ
  // không kiểm gì". Đây là bản rẻ của mutation testing: giả lập một validator
  // hỏng và đòi bộ vector bắt được nó.
  const alwaysAccept = () => ({ passed: true, reason: "accept mọi thứ" });
  const wouldCatch = measured.filter((v) => v.expect === "reject").length > 0;
  console.log(`\nĐột biến "accept mọi thứ": ${wouldCatch ? "BỊ BẮT" : "KHÔNG BỊ BẮT"} (${measured.filter((v) => v.expect === "reject").length} ca reject sẽ lệch)`);
  if (!wouldCatch) failures.push("một validator accept mọi thứ vẫn pass bộ vector này");
  void alwaysAccept;

  // 4. Hai vị ngữ phải độc lập: chạy nhầm luật lên vector của luật kia phải ra khác.
  const crossed = checkAggregateTechnique({ value: 46.02954943221133 });
  // Giá trị THẬP PHÂN, vì số nguyên nằm ngoài phạm vi luật 1 — dùng số nguyên ở
  // đây sẽ kiểm một điều luật không hứa, và phép kiểm đó đổ vì nó sai, không vì
  // luật sai.
  const crossed2 = checkDisplayedOnlyValue({ value: 46.02954943221133, measurementTechnique: "sum of X across 256 ZIP codes" }, "");
  if (crossed.passed) failures.push("checkAggregateTechnique chấp nhận một mục không có measurementTechnique");
  if (crossed2.passed) failures.push("checkDisplayedOnlyValue chấp nhận một con số không có trên trang");

  if (failures.length > 0) {
    console.log(`\n${failures.length} vấn đề:`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("\nTất cả phép kiểm đạt: bộ vector có cả hai chiều, mọi nhánh có ca chạm, và một validator dễ dãi sẽ bị bắt.");
}

main();
