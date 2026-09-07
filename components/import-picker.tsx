"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CoverageImportOption {
  id: string;
  fileName: string;
  network: string;
  importedAt: string;
  rowCount: number;
}

export function ImportPicker({ imports, currentId }: { imports: CoverageImportOption[]; currentId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(value: string | null) {
    if (!value) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("import", value);
    params.set("tab", "overview");
    router.push(`${pathname}?${params.toString()}`);
  }

  function labelFor(id: string | null) {
    const imp = imports.find((i) => i.id === id);
    if (!imp) return null;
    return `${imp.network} — ${imp.fileName} (${new Date(imp.importedAt).toLocaleDateString()}, ${imp.rowCount} dòng)`;
  }

  return (
    <Select value={currentId} onValueChange={onChange}>
      <SelectTrigger className="w-[340px]">
        <SelectValue placeholder="Chọn lần nhập vùng phủ">
          {(value: string | null) => labelFor(value) ?? "Chọn lần nhập vùng phủ"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {imports.map((imp) => (
          <SelectItem key={imp.id} value={imp.id}>
            {imp.network} — {imp.fileName} ({new Date(imp.importedAt).toLocaleDateString()}, {imp.rowCount} dòng)
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
