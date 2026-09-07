import { prisma } from "@/lib/db/prisma";

export interface CandidateNiche {
  vertical: string;
  label: string;
  rationale: string;
}

/**
 * Curated starting list of niches with a real, credible pay-per-call/lead-gen
 * angle AND a real public data source to back real (non-fabricated) page
 * content — not an AI-guessed list. Editable without a code change via
 * AppConfig key "candidateNiches" (same override pattern as
 * estConversionRateByVertical in lib/scoring/market-score.ts): pass either a
 * full replacement array or add-only entries, your call when you edit it.
 */
const DEFAULT_CANDIDATE_NICHES: CandidateNiche[] = [
  { vertical: "solar-installation", label: "Lắp đặt điện mặt trời", rationale: "Có dữ liệu thật từ NREL PVWatts (Module 2) — CPC cao trong pay-per-call năng lượng." },
  { vertical: "roofing-replacement", label: "Thay mái nhà", rationale: "Home services kinh điển, payout cao, đã có dữ liệu demo." },
  { vertical: "hvac-repair", label: "Sửa chữa HVAC", rationale: "Home services, nhu cầu quanh năm, đã có dữ liệu demo." },
  { vertical: "garage-door-repair", label: "Sửa cửa gara", rationale: "Home services, cạnh tranh thấp hơn roofing/HVAC." },
  { vertical: "water-damage-restoration", label: "Khắc phục hư hại nước", rationale: "Home services khẩn cấp — có thể gắn dữ liệu khí hậu NOAA (đã đăng ký DataSource)." },
  { vertical: "pest-control", label: "Diệt côn trùng", rationale: "Home services — gắn được dữ liệu khí hậu/độ ẩm NOAA theo mùa." },
  { vertical: "tax-relief", label: "Giải quyết nợ thuế", rationale: "Lead-gen tài chính CPC cao — gắn được dữ liệu thuế bang (Census State Tax Collections)." },
  { vertical: "debt-relief", label: "Giải quyết nợ tiêu dùng", rationale: "Lead-gen tài chính CPC cao — gắn được chỉ số kinh tế FRED." },
  { vertical: "mortgage-refinance", label: "Tái cấp vốn vay mua nhà", rationale: "CPC rất cao — gắn được lãi suất vay FRED + chỉ số giá nhà FHFA." },
  { vertical: "senior-care", label: "Chăm sóc người cao tuổi", rationale: "Nhu cầu tăng theo dân số già hóa — gắn được tỷ lệ dân số cao tuổi (Census ACS)." },
  { vertical: "moving-services", label: "Dịch vụ chuyển nhà", rationale: "Gắn được dữ liệu di cư IRS/Census theo county." },
  { vertical: "auto-accident-attorney", label: "Luật sư tai nạn giao thông", rationale: "Pay-per-call giá trị rất cao — gắn được dữ liệu tai nạn công khai NHTSA FARS." },
  { vertical: "medicare-plans", label: "Gói bảo hiểm Medicare", rationale: "Lead-gen bảo hiểm CPC cao — nhắm theo tỷ lệ dân số 65+ (Census ACS)." },
];

export async function getCandidateNiches(): Promise<CandidateNiche[]> {
  const config = await prisma.appConfig.findUnique({ where: { key: "candidateNiches" } });
  if (Array.isArray(config?.value)) {
    return config.value as unknown as CandidateNiche[];
  }
  return DEFAULT_CANDIDATE_NICHES;
}

/** Candidate niches that don't already have a MarketIdentity in the system
 * — from a prior TRAFFIC-mode run of this same list, or from a real
 * PAYOUT-mode coverage import that happens to cover the same vertical.
 * Either way, "already researched" means don't suggest it again. */
export async function getSuggestedNiches(): Promise<CandidateNiche[]> {
  const [candidates, existingVerticals] = await Promise.all([
    getCandidateNiches(),
    prisma.marketIdentity.findMany({ select: { vertical: true }, distinct: ["vertical"] }),
  ]);
  const existingSet = new Set(existingVerticals.map((v) => v.vertical));
  return candidates.filter((c) => !existingSet.has(c.vertical));
}
