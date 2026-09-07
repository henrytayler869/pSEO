"use client";

import type { ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LayoutDashboard, Sparkles, TrendingUp, GitCompare } from "lucide-react";

// "diff" (Coverage Diff) is temporarily hidden rather than deleted — it only
// means something once a real coverage-import/network relationship exists
// (see README "No manual data-import UI"). Re-enable by passing showDiff
// (once the caller has one to pass) — the tab, its content, and the
// underlying diffCoverageImports()/DiffPicker code are all still here
// untouched, just not rendered.
const BASE_TABS = ["overview", "research", "trend"];

export function MarketsTabs({
  overview,
  research,
  trend,
  diff,
  showDiff = false,
}: {
  overview: ReactNode;
  research: ReactNode;
  trend: ReactNode;
  diff?: ReactNode;
  showDiff?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const validTabs = showDiff ? [...BASE_TABS, "diff"] : BASE_TABS;
  const requestedTab = searchParams.get("tab") ?? "overview";
  const activeTab = validTabs.includes(requestedTab) ? requestedTab : "overview";

  function onValueChange(value: unknown) {
    if (typeof value !== "string") return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Tabs value={activeTab} onValueChange={onValueChange}>
      <TabsList>
        <TabsTrigger value="overview">
          <LayoutDashboard className="h-3.5 w-3.5" /> Tổng quan
        </TabsTrigger>
        <TabsTrigger value="research">
          <Sparkles className="h-3.5 w-3.5" /> Nghiên cứu niche
        </TabsTrigger>
        <TabsTrigger value="trend">
          <TrendingUp className="h-3.5 w-3.5" /> Xu hướng traffic
        </TabsTrigger>
        {showDiff && (
          <TabsTrigger value="diff">
            <GitCompare className="h-3.5 w-3.5" /> So sánh phạm vi phủ
          </TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="overview" className="pt-4">
        {overview}
      </TabsContent>
      <TabsContent value="research" className="pt-4">
        {research}
      </TabsContent>
      <TabsContent value="trend" className="pt-4">
        {trend}
      </TabsContent>
      {showDiff && (
        <TabsContent value="diff" className="pt-4">
          {diff}
        </TabsContent>
      )}
    </Tabs>
  );
}
