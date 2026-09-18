// Chạy: tsx scripts/test-cluster-validator.ts
//
// Bộ ca cho validator CỤM.
//
// Trước file này, CLUSTER_VALIDATOR_RULES không có ca nào — không script nào
// đọc danh sách đó. Bên theo ZIP đã ghi sẵn vì sao điều đó nguy hiểm:
// "một luật chưa từng được quan sát là chặn được gì thì lúc nó im cũng không
// nói lên điều gì". Câu đó đúng với cả tập luật cụm, và tập luật cụm là tập
// KHÔNG có ai canh — nên nó đã im suốt 115 bản nháp mà không ai biết nó có
// kêu được hay không.
//
// Không chạm mạng, không chạm DB: fact set dựng tay. Một bộ ca phải chạy
// được cả khi không có khoá và không có dữ liệu, nếu không nó sẽ bị bỏ khỏi
// CI đúng lúc cần nhất.

import { validateClusterText, CLUSTER_VALIDATOR_RULES, type ClusterValidatorRule } from "../lib/ai/cluster-validate";
import type { ClusterFactSet } from "../lib/ai/cluster-facts";

const SET: ClusterFactSet = {
  vertical: "auto-accident-attorney",
  label: "/auto-accident-attorney/ca/san-diego",
  memberZips: ["92105", "92126", "92154"],
  city: "San Diego",
  state: "CA",
  county: "San Diego County",
  searchIntent: "commercial",
  fingerprint: "test",
  facts: [
    {
      key: "commute_car_share__min",
      label: "share of workers who commute by car, truck or van — lowest of the 3 ZIPs (ZIP 92126)",
      value: 74.9,
      display: "74.9%",
      unit: "%",
      scope: "ZIP",
      scopeName: "92126",
    },
    {
      key: "commute_car_share__max",
      label: "share of workers who commute by car, truck or van — highest of the 3 ZIPs (ZIP 92154)",
      value: 86.8,
      display: "86.8%",
      unit: "%",
      scope: "ZIP",
      scopeName: "92154",
    },
    {
      key: "fars_fatalities_1yr",
      label: "people killed in traffic crashes in a year",
      value: 286,
      display: "286 people",
      unit: "people/yr",
      scope: "COUNTY",
      scopeName: "San Diego County",
    },
  ],
};

interface Case {
  name: string;
  text: string;
  shouldPass: boolean;
}

const CASES: Case[] = [
  {
    name: "nêu dải, gọi tên hai đầu",
    shouldPass: true,
    text:
      "Across the three ZIP codes on this page, car commuting ranges from 74.9% in ZIP 92126 to 86.8% in ZIP 92154. " +
      "Countywide, 286 people were killed in traffic crashes in San Diego County in a year.",
  },
  {
    name: "bịa một con số",
    shouldPass: false,
    text: "Across these ZIP codes, 91.4% of workers drive to work.",
  },
  {
    name: "một đầu dải nói như thể tả cả vùng",
    shouldPass: false,
    text: "Car commuting here is 74.9%, which shapes how people get around.",
  },
  {
    // "people/yr" gọi thành "households": con số ĐÚNG, danh từ SAI — và
    // luật số không bắt được vì con số vẫn khớp một fact.
    name: "gọi sai đơn vị của một chỉ số",
    shouldPass: false,
    text:
      "Across the three ZIP codes, car commuting ranges from 74.9% in ZIP 92126 to 86.8% in ZIP 92154. " +
      "Countywide, 286 households were killed in traffic crashes in San Diego County in a year.",
  },
  {
    /**
     * Ca này là ca ĐÃ XẢY RA THẬT, không phải giả định: đo 19/9/2026, cụm
     * san-diego trượt 6 lần liên tiếp, ngay lần đầu đã là tiếng Việt, vì nhãn
     * trong prompt mang chữ Việt. Nguyên nhân gốc đã vá; ca này giữ cho lần
     * trôi sau không lặng lẽ như lần này.
     */
    name: "viết bằng tiếng Việt",
    shouldPass: false,
    text: "Ba ZIP trong trang này không giống nhau ở mức độ phụ thuộc vào ô tô.",
  },
  {
    /** Tên nơi chốn có thật ở Mỹ mang dấu — KHÔNG được coi là ngoại ngữ. */
    name: "tên nơi chốn có dấu vẫn đạt",
    shouldPass: true,
    text:
      "Across the three ZIP codes on this page, car commuting ranges from 74.9% in ZIP 92126 to 86.8% in ZIP 92154, " +
      "a spread wider than anything seen around Cañon City or Coeur d'Alene.",
  },
];

function main() {
  const triggered = new Set<ClusterValidatorRule>();
  const failures: string[] = [];
  let passed = 0;

  for (const c of CASES) {
    const r = validateClusterText(c.text, SET);
    for (const i of r.issues) triggered.add(i.rule);
    const ok = r.passed === c.shouldPass;
    if (ok) passed++;
    else failures.push(c.name);
    console.log(
      `${ok ? "✓" : "✗"} ${c.name} — mong ${c.shouldPass ? "đạt" : "trượt"}, được ${r.passed ? "đạt" : "trượt"}` +
        (r.issues.length ? ` [${r.issues.map((i) => i.rule).join(", ")}]` : "")
    );
  }

  console.log(`\n${passed}/${CASES.length} ca đúng.`);
  if (failures.length > 0) {
    console.error(`THẤT BẠI: ${failures.join(", ")}`);
    process.exitCode = 1;
  }

  const never = CLUSTER_VALIDATOR_RULES.filter((r) => !triggered.has(r));
  if (never.length > 0) {
    console.error(`\nĐỘ PHỦ LUẬT THIẾU — không ca nào làm các luật này kêu: ${never.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`Độ phủ: cả ${CLUSTER_VALIDATOR_RULES.length} luật cụm đều có ca làm nó kêu.`);
  }
}

main();
