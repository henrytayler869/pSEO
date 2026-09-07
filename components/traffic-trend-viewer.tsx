"use client";

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrafficTrendChart } from "@/components/traffic-trend-chart";
import { formatVertical } from "@/lib/format";
import type { TrafficTrendPoint } from "@/lib/queries/traffic-research";

export function TrafficTrendViewer({
  trendsByVertical,
}: {
  trendsByVertical: Record<string, TrafficTrendPoint[]>;
}) {
  const verticals = Object.keys(trendsByVertical);
  const [selected, setSelected] = useState(verticals[0] ?? "");

  if (verticals.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có niche nào được nghiên cứu để xem xu hướng.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Select value={selected} onValueChange={(v) => v && setSelected(v)}>
        <SelectTrigger className="w-[280px]">
          <SelectValue>{(value: string | null) => (value ? formatVertical(value) : "")}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {verticals.map((v) => (
            <SelectItem key={v} value={v}>
              {formatVertical(v)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <TrafficTrendChart points={trendsByVertical[selected] ?? []} />
    </div>
  );
}
