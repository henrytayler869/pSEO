"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CoverageImportOption {
  id: string;
  fileName: string;
  importedAt: string;
}

export function DiffPicker({
  imports,
  olderId,
  newerId,
}: {
  imports: CoverageImportOption[];
  olderId: string;
  newerId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function update(next: { older?: string; newer?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("older", next.older ?? olderId);
    params.set("newer", next.newer ?? newerId);
    params.set("tab", "diff");
    router.push(`${pathname}?${params.toString()}`);
  }

  function labelFor(id: string | null) {
    const imp = imports.find((i) => i.id === id);
    return imp ? `${imp.fileName} (${new Date(imp.importedAt).toLocaleDateString()})` : "";
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Cũ hơn (mốc gốc)</span>
        <Select value={olderId} onValueChange={(v) => v && update({ older: v })}>
          <SelectTrigger className="w-[300px]">
            <SelectValue>{(value: string | null) => labelFor(value)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {imports.map((imp) => (
              <SelectItem key={imp.id} value={imp.id}>
                {imp.fileName} ({new Date(imp.importedAt).toLocaleDateString()})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <span className="mt-5 text-muted-foreground">→</span>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Mới hơn (hiện tại)</span>
        <Select value={newerId} onValueChange={(v) => v && update({ newer: v })}>
          <SelectTrigger className="w-[300px]">
            <SelectValue>{(value: string | null) => labelFor(value)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {imports.map((imp) => (
              <SelectItem key={imp.id} value={imp.id}>
                {imp.fileName} ({new Date(imp.importedAt).toLocaleDateString()})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
