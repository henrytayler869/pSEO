// Ý định phải ĐẾN TỪ DỮ LIỆU, và "chưa đo" phải khác "không có".
//
// Dùng: tsx scripts/test-intents.ts

import { summariseIntents, type IntentRow } from "../lib/keywords/intents";

const CASES: { name: string; rows: IntentRow[]; check: (out: ReturnType<typeof summariseIntents>) => string | null }[] = [
  {
    name: "từ khoá CHƯA ĐO ý định -> không bị xếp vào nhóm nào",
    rows: [
      { keyword: "a", searchVolume: 100, mainIntent: null, foreignIntent: [] },
      { keyword: "b", searchVolume: 200, mainIntent: null, foreignIntent: [] },
    ],
    check: (out) =>
      out.length === 0
        ? null
        : `chưa đo mà vẫn sinh ra ${out.length} nhóm: ${out.map((o) => o.id).join(", ")} — đó là bằng chứng giả`,
  },
  {
    name: "ý định phụ đếm riêng, KHÔNG cộng vào số từ khoá chính",
    rows: [
      { keyword: "a", searchVolume: 100, mainIntent: "informational", foreignIntent: ["commercial"] },
      { keyword: "b", searchVolume: 300, mainIntent: "commercial", foreignIntent: [] },
    ],
    check: (out) => {
      const c = out.find((o) => o.id === "commercial");
      if (!c) return "mất nhóm commercial";
      if (c.keywordCount !== 1) return `commercial đếm ${c.keywordCount} từ khoá chính, đáng lẽ 1 — ý định phụ đang bị cộng vào`;
      if (c.alsoServes !== 1) return `alsoServes = ${c.alsoServes}, đáng lẽ 1`;
      return null;
    },
  },
  {
    name: "sắp theo volume, không theo số từ khoá",
    rows: [
      { keyword: "a", searchVolume: 10, mainIntent: "commercial", foreignIntent: [] },
      { keyword: "b", searchVolume: 10, mainIntent: "commercial", foreignIntent: [] },
      { keyword: "c", searchVolume: 5000, mainIntent: "informational", foreignIntent: [] },
    ],
    check: (out) =>
      out[0]?.id === "informational"
        ? null
        : `đứng đầu là "${out[0]?.id}" — đang xếp theo số từ khoá chứ không theo nhu cầu thật`,
  },
  {
    name: "một nhóm một từ khoá vẫn hiện ra, kèm đúng con số",
    rows: [
      { keyword: "moving help", searchVolume: 12100, mainIntent: "informational", foreignIntent: [] },
      { keyword: "movers near me", searchVolume: 14800, mainIntent: "commercial", foreignIntent: [] },
    ],
    check: (out) => {
      const i = out.find((o) => o.id === "informational");
      if (!i) return "nhóm một từ khoá bị nuốt mất";
      return i.keywordCount === 1 && i.totalVolume === 12100 ? null : `số liệu sai: ${i.keywordCount} / ${i.totalVolume}`;
    },
  },
  {
    name: "ví dụ KHÔNG lặp lại cùng một chuỗi",
    rows: [
      { keyword: "moving companies new york", searchVolume: 10, mainIntent: "commercial", foreignIntent: [] },
      { keyword: "moving companies new york", searchVolume: 10, mainIntent: "commercial", foreignIntent: [] },
      { keyword: "movers dallas", searchVolume: 10, mainIntent: "commercial", foreignIntent: [] },
    ],
    check: (out) => {
      const ex = out[0]?.examples ?? [];
      return new Set(ex).size === ex.length ? null : `ví dụ lặp: ${ex.join(", ")}`;
    },
  },
  {
    name: "ví dụ là từ khoá THẬT, để người đọc tự phán đoán",
    rows: [{ keyword: "moving services prices", searchVolume: 2900, mainIntent: "commercial", foreignIntent: [] }],
    check: (out) => (out[0]?.examples[0] === "moving services prices" ? null : "không kèm từ khoá thật làm ví dụ"),
  },
];

let ok = 0;
const failures: string[] = [];
for (const c of CASES) {
  const err = c.check(summariseIntents(c.rows));
  if (err === null) ok++;
  else failures.push(`${c.name}\n      ${err}`);
  console.log(`${err === null ? "✓" : "✗"} ${c.name}`);
}

console.log(`\n${ok}/${CASES.length} kiểm tra đúng.`);
if (failures.length > 0) {
  console.error(`\nTHẤT BẠI:\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
}
