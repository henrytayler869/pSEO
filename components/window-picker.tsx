import Link from "next/link";
import { WINDOWS, type Window } from "@/lib/queries/publisher-analytics";

/**
 * Chọn khoảng thời gian, bằng LINK chứ không bằng state.
 *
 * Khoảng thời gian nằm trong URL nên nó chia sẻ được, quay lại được, và làm
 * mới trang không mất. Một select dùng state trông hiện đại hơn và đánh mất
 * cả ba thứ đó.
 */
export function WindowPicker({ base, active }: { base: string; active: Window }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">Khoảng:</span>
      {WINDOWS.map((w) => (
        <Link
          key={w}
          href={`${base}?days=${w}`}
          className={
            w === active
              ? "rounded border border-foreground px-2 py-0.5 font-medium"
              : "rounded border border-transparent px-2 py-0.5 text-muted-foreground hover:border-(--color-border-subtle)"
          }
        >
          {w} ngày
        </Link>
      ))}
    </div>
  );
}
