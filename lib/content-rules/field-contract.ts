import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { formatForPrompt, formatNumberForPrompt, unitWordFor } from "@/lib/ai/facts";

export interface FieldContract {
  /** What the field means, in words. For READING. Never for deciding. */
  label: string;
  /**
   * Digest of the field's ACTUAL behaviour. This is the authority.
   *
   * A consumer stores it, compares on every fetch, and fails when it moves.
   * It cannot lie the way `label` can, because nothing produces it except
   * running the thing it describes.
   */
  hash: string;
  /** What the hash was computed over, so a consumer can see the shape of the
   * thing being watched rather than trusting an opaque string. */
  coversWhat: string;
}

/**
 * Per-field semantic contract for /api/v1.
 *
 * Asked for by the consuming site after a real incident on 2026-09-10: HQ
 * changed what `display` MEANS — bare number to number-plus-unit — without
 * bumping any version, and their zod schema kept accepting `string` because
 * the TYPE had not changed. 126 published pages rendered
 * "67,282 households households" for hours. Nothing in the response could have
 * warned them, because every field was still the type it had always been.
 *
 * Their design, and the reasoning is theirs:
 *
 *   HASH decides, LABEL is only for reading. If they disagree, the label is
 *   wrong.
 *
 * A label is written by a person and drifts from behaviour — exactly as a
 * comment in their own repo once described one rounding rule while the code
 * did another. A hash computed from running the thing cannot drift, because
 * nobody has to remember to update it.
 *
 * PER FIELD, not one digest for the whole response — also their requirement,
 * and the reason is a failure they lived through: a single response-wide hash
 * goes red for every change anywhere, and a signal that is red for reasons
 * that do not concern you is a signal you learn to ignore. Their edge-purge
 * warning died that way, four deploys running.
 */
export type FieldContracts = Record<string, FieldContract>;

function digest(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/**
 * Inputs the formatter fields are hashed over.
 *
 * Fixed and boring on purpose. Every branch of `formatForPrompt` is
 * represented — percent, scaled dollars, plain dollars, year, integer with a
 * unit word, decimal, and a unit deliberately mapped to no word — so a change
 * to ANY branch moves the hash. Probes that only cover the common path would
 * produce a hash that stays still while a rare branch changes underneath it,
 * which is the same "signal that cannot fire" this file exists to prevent.
 */
const FORMAT_PROBES: { value: number; unit: string }[] = [
  { value: 7.6342, unit: "%" },
  { value: 2249409000, unit: "USD" },
  { value: 71673.75, unit: "USD/yr" },
  { value: 1980, unit: "year" },
  { value: 67282, unit: "households/yr" },
  { value: 1845, unit: "people/yr" },
  { value: 8.79, unit: "in/yr" },
  { value: 17, unit: "count/10yr" },
  { value: 4823, unit: "degree-days/yr" },
  { value: 11.4, unit: "cents/kWh" },
];

export async function buildFieldContracts(): Promise<FieldContracts> {
  // --- fields produced by a function: hash what the function DOES ---
  const display = FORMAT_PROBES.map((p) => formatForPrompt(p.value, p.unit));
  const displayNumber = FORMAT_PROBES.map((p) => formatNumberForPrompt(p.value, p.unit));
  const unitWord = FORMAT_PROBES.map((p) => unitWordFor(p.unit));

  // --- fields whose meaning lives in DATA: hash the data's shape ---
  //
  // Not the values themselves — those change every collection run and a hash
  // that moves on every run is noise. What is hashed is the VOCABULARY: which
  // unit strings exist, which source is called what, which metric is measured
  // at which geography. Those are the things that change silently and break a
  // consumer that keyed on them.
  const [units, sources, resolutions] = await Promise.all([
    prisma.dataPoint.findMany({ select: { unit: true }, distinct: ["unit"] }),
    prisma.dataSource.findMany({ select: { adapterKey: true, name: true }, orderBy: { adapterKey: "asc" } }),
    prisma.dataPoint.findMany({
      select: { metric: true, resolvedAtResolution: true },
      distinct: ["metric", "resolvedAtResolution"],
      orderBy: [{ metric: "asc" }, { resolvedAtResolution: "asc" }],
    }),
  ]);

  return {
    display: {
      label: "number + unit word, e.g. \"67,282 households\"",
      hash: digest(display),
      coversWhat: `đầu ra của formatForPrompt() trên ${FORMAT_PROBES.length} đầu vào phủ mọi nhánh`,
    },
    displayNumber: {
      label: "the number alone, no unit word, e.g. \"67,282\"",
      hash: digest(displayNumber),
      coversWhat: `đầu ra của formatNumberForPrompt() trên ${FORMAT_PROBES.length} đầu vào`,
    },
    unitWord: {
      label: "the word already inside `display` (\"\" = none by design, null = unit has no word yet)",
      hash: digest(unitWord),
      coversWhat: `đầu ra của unitWordFor() trên ${FORMAT_PROBES.length} đơn vị`,
    },
    unit: {
      label: "machine unit string, e.g. \"households/yr\"",
      hash: digest(units.map((u) => u.unit).sort()),
      coversWhat: `tập ${units.length} chuỗi đơn vị đang tồn tại`,
    },
    sourceName: {
      label: "human name of the government source, printed as attribution",
      // Named by the consuming site as the single most dangerous field to
      // change silently: a wrong number can be checked against the source, a
      // wrong SOURCE NAME leaves nothing to check against. It goes into a
      // credit line on every page and into measurementTechnique in JSON-LD.
      hash: digest(sources.map((s) => [s.adapterKey, s.name])),
      coversWhat: `ánh xạ adapterKey -> name của ${sources.length} nguồn`,
    },
    resolvedAtResolution: {
      label: "geography a metric is actually measured at (ZIP / COUNTY / STATE)",
      hash: digest(resolutions.map((r) => [r.metric, r.resolvedAtResolution])),
      coversWhat: `ánh xạ metric -> resolution của ${resolutions.length} cặp`,
    },
  };
}

export interface SensitivityProof {
  field: string;
  /** True when perturbing ONE element of what the field is hashed over moves
   * that field's hash — and moves NOTHING else. */
  isolated: boolean;
  detail: string;
}

/**
 * Proves each hash is sensitive to its own field and deaf to the others.
 *
 * Without this, `fieldContract` is six pretty strings. A hash computed over
 * the wrong thing — a constant, an empty array, a value that never changes —
 * looks identical to a hash that works, and the consumer built its failure
 * detection on top of it.
 *
 * Two properties, and both matter for a different reason:
 *
 *   SENSITIVE   perturb the field's input, its hash moves.
 *               Without it the hash never fires and the consumer trusts a
 *               field that is silently drifting — the exact incident this
 *               whole mechanism was built after.
 *
 *   ISOLATED    perturbing one field moves ONLY that field's hash.
 *               Without it every change reddens everything, and a signal that
 *               is red for reasons that do not concern you is one you learn to
 *               ignore. The consuming site lost their edge-purge warning that
 *               way, four deploys running.
 *
 * Perturbation is done on the hashed INPUT rather than by mutating the source,
 * so this runs in CI without touching anything.
 */
export function proveFieldContractSensitivity(actual: FieldContracts): SensitivityProof[] {
  const inputs: Record<string, unknown[]> = {
    display: FORMAT_PROBES.map((p) => formatForPrompt(p.value, p.unit)),
    displayNumber: FORMAT_PROBES.map((p) => formatNumberForPrompt(p.value, p.unit)),
    unitWord: FORMAT_PROBES.map((p) => unitWordFor(p.unit)),
  };

  const proofs: SensitivityProof[] = [];
  for (const [field, arr] of Object.entries(inputs)) {
    if (arr.length === 0) {
      proofs.push({ field, isolated: false, detail: "không có đầu vào nào để nhiễu — băm này không thể đổi" });
      continue;
    }
    // HAI nửa, và nửa đầu là nửa tôi quên ở bản đầu.
    //
    // "băm của đầu vào bị nhiễu KHÁC băm công bố" tự động đúng khi băm công bố
    // được tính từ một thứ hoàn toàn khác — một hằng số, chẳng hạn. Đo
    // 2026-09-10: đổi hash của displayNumber thành digest("HANG_SO") và phép
    // kiểm vẫn xanh 20/20. Nó không phân biệt được "băm đúng và nhạy" với "băm
    // lấy từ chỗ khác".
    //
    // Nên phải hỏi cả hai:
    //   NGUỒN  băm công bố có ĐẾN TỪ đầu vào này không
    //   NHẠY   nhiễu đầu vào có làm nó đổi không
    const published = actual[field]?.hash;
    const fromThisInput = digest(arr) === published;

    // Nhiễu phần tử CUỐI, không phải phần tử đầu: một digest dựng từ danh sách
    // bị cắt hoặc bị short-circuit vẫn phản ứng với phần tử 0 mà bỏ qua mọi
    // thứ sau nó.
    const perturbed = [...arr];
    perturbed[perturbed.length - 1] = `${String(perturbed[perturbed.length - 1])}~`;
    const moves = digest(perturbed) !== published;

    proofs.push({
      field,
      isolated: fromThisInput && moves,
      detail: !fromThisInput
        ? "băm công bố KHÔNG đến từ đầu vào này — nó đang soi thứ khác"
        : moves
          ? "băm đến từ đầu vào này, và nhiễu phần tử CUỐI làm nó đổi"
          : "nhiễu phần tử cuối KHÔNG làm băm đổi",
    });
  }

  // Every field must have a distinct hash. Two fields sharing one means both
  // are hashed over the same thing, and one of them is watching the wrong
  // value while reading as if it watches its own.
  const hashes = Object.entries(actual).map(([f, c]) => [f, c.hash] as const);
  const seen = new Map<string, string>();
  for (const [field, h] of hashes) {
    const prev = seen.get(h);
    if (prev) proofs.push({ field, isolated: false, detail: `trùng băm với "${prev}" — hai trường soi cùng một thứ` });
    else seen.set(h, field);
  }
  return proofs;
}
