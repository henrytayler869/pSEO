// Chứng minh validator cấp cụm bắt được thứ validator cấp ZIP không bắt.
//
// Ca quan trọng nhất là ca thứ ba: một con số THẬT, không vi phạm luật nào
// của bên ZIP, nhưng mô tả một ZIP trong khi câu nói về cả cụm. Không ca đó
// thì file này chỉ là bản sao mỏng của validator cũ.
//
// Dùng: tsx scripts/test-cluster-validate.ts

import { validateClusterText } from "../lib/ai/cluster-validate";
import type { ClusterFactSet } from "../lib/ai/cluster-facts";

const SET: ClusterFactSet = {
  vertical: "moving-services",
  label: "/moving-services/ny/brooklyn",
  memberZips: ["11212", "11234"],
  city: "New York",
  state: "NY",
  county: "Kings County",
  searchIntent: "commercial",
  fingerprint: "test",
  facts: [
    {
      key: "census_homeownership_rate_pct__min",
      label: "homeownership rate — thấp nhất trong 23 ZIP (ZIP 11212)",
      value: 10.892,
      display: "10.9%",
      unit: "percent",
      scope: "ZIP",
      scopeName: "11212",
    },
    {
      key: "census_homeownership_rate_pct__max",
      label: "homeownership rate — cao nhất trong 23 ZIP (ZIP 11234)",
      value: 67.288,
      display: "67.3%",
      unit: "percent",
      scope: "ZIP",
      scopeName: "11234",
    },
    {
      key: "irs_migration_net_households",
      label: "net household migration",
      value: -40453,
      display: "-40,453 households",
      unit: "households/yr",
      scope: "COUNTY",
      scopeName: "Kings County",
    },
  ],
};

const CASES: { name: string; text: string; expect: string | null }[] = [
  {
    name: "con số không có trong fact -> unsupported_number",
    text: "Homeownership across these ZIP codes ranges from 10.9% to 41.2%.",
    expect: "unsupported_number",
  },
  {
    name: "ĐẦU DẢI nói như giá trị cả cụm -> range_endpoint_as_whole",
    text: "Homeownership in Brooklyn is 10.9%, so most moves involve rentals.",
    expect: "range_endpoint_as_whole",
  },
  {
    name: "cùng con số đó, nhưng nói rõ là một đầu dải -> KHÔNG trượt",
    text: "Homeownership ranges from 10.9% to 67.3% depending on which ZIP you are moving to.",
    expect: null,
  },
  {
    name: "dùng chữ 'as low as' cũng là tín hiệu dải -> KHÔNG trượt",
    text: "Ownership runs as low as 10.9% in one ZIP and as high as 67.3% in another.",
    expect: null,
  },
  {
    name: "chỉ số cấp county nêu thẳng -> KHÔNG trượt (nó đúng cho cả cụm)",
    text: "Across the county, net household migration was -40,453 households.",
    expect: null,
  },
  {
    name: "nêu ZIP THÀNH VIÊN -> KHÔNG trượt (fact set đã đưa tên ZIP trong nhãn)",
    text: "Homeownership ranges from 10.9% in ZIP 11212 to 67.3% in ZIP 11234.",
    expect: null,
  },
  {
    name: "nêu ZIP KHÔNG thuộc cụm -> unsupported_number",
    text: "Homeownership ranges from 10.9% to 67.3%, and ZIP 90210 sits in between.",
    expect: "unsupported_number",
  },
  {
    name: "sai từ đơn vị -> wrong_unit",
    text: "Homeownership ranges from 10.9 households to 67.3% across these ZIP codes.",
    expect: "wrong_unit",
  },
];

let ok = 0;
const failures: string[] = [];
for (const c of CASES) {
  const r = validateClusterText(c.text, SET);
  const rules = r.issues.map((i) => i.rule);
  const good = c.expect === null ? r.passed : rules.includes(c.expect as never);
  if (good) ok++;
  else failures.push(`${c.name}\n      nhận [${rules.join(", ") || "không lỗi nào"}], kỳ vọng ${c.expect ?? "không lỗi nào"}`);
  console.log(`${good ? "✓" : "✗"} ${c.name}`);
}

// Mọi luật phải có ca làm nó kêu — nếu không, một luật chết nằm trong file mà
// bộ test vẫn xanh.
const fired = new Set(CASES.flatMap((c) => validateClusterText(c.text, SET).issues.map((i) => i.rule)));
const never = ["unsupported_number", "wrong_unit", "range_endpoint_as_whole"].filter((r) => !fired.has(r as never));
console.log();
if (never.length === 0) {
  ok++;
  console.log("✓ độ phủ: cả 3 luật đều có ca làm nó kêu");
} else {
  failures.push(`luật chưa ca nào làm kêu: ${never.join(", ")}`);
  console.log(`✗ độ phủ: ${never.join(", ")}`);
}

console.log(`\n${ok}/${CASES.length + 1} kiểm tra đúng.`);
if (failures.length > 0) {
  console.error(`\nTHẤT BẠI:\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
}
