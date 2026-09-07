import type { TrafficTrendPoint } from "@/lib/queries/traffic-research";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const CHART_WIDTH = 640;
const CHART_HEIGHT = 160;
const PADDING = 24;

export function TrafficTrendChart({ points }: { points: TrafficTrendPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Chưa đủ dữ liệu để vẽ xu hướng — niche này mới chỉ được chấm điểm{" "}
        {points.length === 1 ? "1 lần" : "0 lần"}. Chạy lại nghiên cứu niche này vào một ngày khác (hoặc đợi
        scripts/run-scheduled-niche-research.ts chạy định kỳ) để có điểm so sánh.
      </p>
    );
  }

  const maxScore = Math.max(...points.map((p) => p.avgScore));
  const minScore = Math.min(...points.map((p) => p.avgScore));
  const scoreRange = maxScore - minScore || 1;
  const innerWidth = CHART_WIDTH - PADDING * 2;
  const innerHeight = CHART_HEIGHT - PADDING * 2;

  const coords = points.map((p, i) => {
    const x = PADDING + (i / (points.length - 1)) * innerWidth;
    const y = PADDING + innerHeight - ((p.avgScore - minScore) / scoreRange) * innerHeight;
    return { x, y, point: p };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");

  return (
    <div className="flex flex-col gap-4">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full text-primary" role="img">
        <path d={path} fill="none" stroke="currentColor" strokeWidth={2} />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={3} fill="currentColor" />
        ))}
      </svg>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ngày</TableHead>
            <TableHead>Điểm trung bình</TableHead>
            <TableHead>Điểm cao nhất</TableHead>
            <TableHead>Số thị trường đã chấm</TableHead>
            <TableHead>Thay đổi so với lần trước</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((p, i) => {
            const prev = points[i - 1];
            const deltaPct = prev ? ((p.avgScore - prev.avgScore) / prev.avgScore) * 100 : null;
            return (
              <TableRow key={p.date}>
                <TableCell>{p.date}</TableCell>
                <TableCell>{p.avgScore.toFixed(1)}</TableCell>
                <TableCell>{p.topScore.toFixed(1)}</TableCell>
                <TableCell>{p.scoredCount}</TableCell>
                <TableCell>
                  {deltaPct === null ? (
                    "—"
                  ) : (
                    <span className={deltaPct >= 0 ? "text-green-700" : "text-red-700"}>
                      {deltaPct >= 0 ? "↑" : "↓"} {Math.abs(deltaPct).toFixed(1)}%
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
