"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const MARKET_COUNTRIES = {
  us: "Hoa Kỳ",
  vn: "Việt Nam",
} as const;

export type MarketCountry = keyof typeof MARKET_COUNTRIES;

/**
 * Đổi nước là đổi sang một BỘ THAM SỐ khác, không phải thêm một tham số.
 *
 * `import`, `tab`, `older`, `newer` đều chỉ có nghĩa ở phía Hoa Kỳ (chúng trỏ
 * vào lần nhập vùng phủ và các tab xếp hạng theo điểm). Giữ chúng lại khi
 * sang Việt Nam thì URL mang theo trạng thái không dùng được, và bấm quay lại
 * sẽ rơi vào một tab không tồn tại ở phía kia. Nên xoá hẳn thay vì giữ cho
 * "an toàn".
 */
export function MarketCountryPicker({ country }: { country: MarketCountry }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(value: string | null) {
    if (!value || value === country) return;
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["import", "tab", "older", "newer", "ucl"]) params.delete(key);
    if (value === "us") params.delete("country");
    else params.set("country", value);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <Select value={country} onValueChange={onChange}>
      <SelectTrigger className="w-[180px]" aria-label="Chọn thị trường">
        <SelectValue placeholder="Chọn thị trường">
          {(value: string | null) => MARKET_COUNTRIES[(value ?? "us") as MarketCountry]}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(MARKET_COUNTRIES).map(([code, label]) => (
          <SelectItem key={code} value={code}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
