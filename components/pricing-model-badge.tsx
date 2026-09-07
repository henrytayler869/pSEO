import { Badge } from "@/components/ui/badge";
import { formatPricingModel } from "@/lib/format";

const COLORS: Record<string, string> = {
  PER_APPOINTMENT: "bg-purple-100 text-purple-800 hover:bg-purple-100 border-purple-200",
  PER_CALL_DURATION: "bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200",
  CPL: "bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200",
};

// Vietnamese labels for the displayed badge text — the underlying enum value (model)
// is never translated, only what the operator sees.
const LABELS_VI: Record<string, string> = {
  PER_APPOINTMENT: "Theo lịch hẹn",
  PER_CALL_DURATION: "Theo cuộc gọi (thời lượng)",
  CPL: "Giá mỗi lead (CPL)",
};

export function PricingModelBadge({ model }: { model: string }) {
  return (
    <Badge variant="outline" className={COLORS[model] ?? ""}>
      {LABELS_VI[model] ?? formatPricingModel(model)}
    </Badge>
  );
}
