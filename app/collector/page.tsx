import Link from "next/link";
import { CheckCircle2, XCircle, AlertTriangle, Circle, DatabaseZap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { RunCollectionForm } from "@/components/run-collection-form";
import { getDataSources, getSnapshotsWithSource, getLatestComparisons } from "@/lib/queries/collector";
import { formatPercentChange } from "@/lib/collector/compare";
import { prisma } from "@/lib/db/prisma";
import {
  runPvWattsCollectionAction,
  runCensusAcsHousingCollectionAction,
  runCensusMobilityCollectionAction,
  runIrsMigrationCollectionAction,
  runNoaaClimateNormalsCollectionAction,
  runEiaElectricityCollectionAction,
  runFemaDisasterDeclarationsCollectionAction,
} from "./actions";

function SnapshotStatusBadge({ status }: { status: string }) {
  if (status === "OK") {
    return (
      <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Hợp lệ
      </Badge>
    );
  }
  if (status === "SUSPECT") {
    return (
      <Badge variant="secondary" className="bg-orange-100 text-orange-800 hover:bg-orange-100">
        <AlertTriangle className="mr-1 h-3 w-3" /> Nghi ngờ
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-red-100 text-red-800 hover:bg-red-100">
      <XCircle className="mr-1 h-3 w-3" /> Lỗi
    </Badge>
  );
}

export default async function CollectorPage() {
  const [sources, snapshots, locationCount, comparisons] = await Promise.all([
    getDataSources(),
    getSnapshotsWithSource(),
    prisma.location.count(),
    getLatestComparisons(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={DatabaseZap}
        title="Thu thập dữ liệu"
        description="Danh mục nguồn dữ liệu, các snapshot, và nút chạy thu thập. Mỗi lần chạy sẽ tạo một DataSnapshot bất biến mới và xác thực ngay lập tức trước khi có thể sử dụng ở bất kỳ đâu phía sau."
      />

      <Card>
        <CardHeader>
          <CardTitle>Danh mục nguồn dữ liệu</CardTitle>
          <CardDescription>
            Chỉ liệt kê nguồn có adapter thật đang hoạt động — không hiển thị nguồn &quot;dự kiến&quot; chưa có code thu
            thập.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nguồn</TableHead>
                <TableHead>Mã adapter</TableHead>
                <TableHead>Dùng cho niche</TableHead>
                <TableHead>Độ phân giải địa lý</TableHead>
                <TableHead>Đơn vị</TableHead>
                <TableHead>Tần suất làm mới</TableHead>
                <TableHead>Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">{s.adapterKey}</TableCell>
                  <TableCell>
                    {s.relevantVerticals.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {s.relevantVerticals.map((v) => (
                          <Badge key={v} variant="outline" className="text-xs">
                            {v}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Chưa gán</span>
                    )}
                  </TableCell>
                  <TableCell>{s.geoResolution}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{s.unit}</TableCell>
                  <TableCell className="text-muted-foreground">{s.refreshInterval}</TableCell>
                  <TableCell>
                    {s.isActive ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">
                        Đang hoạt động
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        <Circle className="mr-1 h-2 w-2" /> Dự kiến
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chạy thu thập dữ liệu</CardTitle>
          <CardDescription>{locationCount} địa điểm đã đăng ký.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              NREL PVWatts — dùng NREL_API_KEY nếu có, nếu không sẽ dùng adapter giả lập khi ALLOW_PVWATTS_MOCK=true.
            </p>
            <RunCollectionForm
              action={runPvWattsCollectionAction}
              label="Chạy thu thập PVWatts"
              pendingLabel="Đang thu thập dữ liệu..."
            />
          </div>
          <div className="flex flex-col gap-2 border-t pt-6">
            <p className="text-sm text-muted-foreground">
              Census ACS5 (nhà ở &amp; thu nhập) — dùng CENSUS_API_KEY, không có đường tắt giả lập cho nguồn này.
            </p>
            <RunCollectionForm
              action={runCensusAcsHousingCollectionAction}
              label="Chạy thu thập Census ACS5"
              pendingLabel="Đang thu thập dữ liệu..."
            />
          </div>
          <div className="flex flex-col gap-2 border-t pt-6">
            <p className="text-sm text-muted-foreground">
              Census ACS5 (di cư địa lý — bảng B07003) — dùng CENSUS_API_KEY. Số người chuyển nhà trong năm qua theo
              từng zip: trong cùng hạt, từ hạt khác, từ bang khác, từ nước ngoài. Là nguồn duy nhất đo hành vi chuyển
              nhà ở <strong>cấp zip</strong> — IRS chỉ có cấp hạt.
            </p>
            <RunCollectionForm
              action={runCensusMobilityCollectionAction}
              label="Chạy thu thập Census di cư"
              pendingLabel="Đang thu thập dữ liệu..."
            />
          </div>
          <div className="flex flex-col gap-2 border-t pt-6">
            <p className="text-sm text-muted-foreground">
              IRS SOI Migration (di cư theo county) — file công khai, không cần API key. Báo cáo theo county, gán cho
              từng zip trong county đó.
            </p>
            <RunCollectionForm
              action={runIrsMigrationCollectionAction}
              label="Chạy thu thập IRS Migration"
              pendingLabel="Đang thu thập dữ liệu..."
            />
          </div>
          <div className="flex flex-col gap-2 border-t pt-6">
            <p className="text-sm text-muted-foreground">
              NOAA Climate Normals — dùng NOAA_API_TOKEN. <strong>Chưa kiểm chứng bằng lệnh gọi thật</strong> (NOAA yêu cầu
              token thật ngay cả để tra cứu metadata, nên chưa thể kiểm tra trước khi có token) — dựa trên tài liệu chính
              thức của NOAA, cổng xác thực sẽ tự đánh dấu SUSPECT nếu shape phản hồi khác giả định.
            </p>
            <RunCollectionForm
              action={runNoaaClimateNormalsCollectionAction}
              label="Chạy thu thập NOAA Climate Normals"
              pendingLabel="Đang thu thập dữ liệu..."
            />
          </div>
          <div className="flex flex-col gap-2 border-t pt-6">
            <p className="text-sm text-muted-foreground">
              EIA Residential Electricity Prices — dùng EIA_API_KEY.{" "}
              <strong>Chưa kiểm chứng bằng lệnh gọi thật</strong> (chưa có API key thật) — dựa trên tài liệu chính thức
              của EIA.
            </p>
            <RunCollectionForm
              action={runEiaElectricityCollectionAction}
              label="Chạy thu thập EIA Electricity"
              pendingLabel="Đang thu thập dữ liệu..."
            />
          </div>
          <div className="flex flex-col gap-2 border-t pt-6">
            <p className="text-sm text-muted-foreground">
              FEMA OpenFEMA Disaster Declarations — API công khai, không cần key. Đếm số lần công bố thảm họa liên bang
              liên quan thiệt hại vật chất (bão, lũ, cháy, v.v. — đã loại &quot;Biological&quot; tức các công bố COVID-19
              để không làm loãng số liệu) theo county trong 10 năm gần nhất, gán cho từng zip trong county đó. Đã kiểm
              chứng trực tiếp bằng lệnh gọi thật.
            </p>
            <RunCollectionForm
              action={runFemaDisasterDeclarationsCollectionAction}
              label="Chạy thu thập FEMA Disaster Declarations"
              pendingLabel="Đang thu thập dữ liệu..."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>So với lần thu thập trước</CardTitle>
          <CardDescription>
            Đối chiếu snapshot mới nhất với snapshot ngay trước đó của cùng nguồn, theo từng địa điểm — không phải so
            trung bình thô, nên không bị che khuất nếu chỉ vài zip biến động mạnh. &quot;Đổi &gt;10%&quot; đếm số zip có
            giá trị lệch trên 10% giữa hai lần.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {comparisons.length === 0 && <p className="text-sm text-muted-foreground">Chưa có snapshot nào để so sánh.</p>}
          {comparisons.map((row) => (
            <div key={row.sourceName} className="flex flex-col gap-2">
              <p className="text-sm font-medium">
                {row.sourceName} — v{row.currentVersion}
                {row.comparison && ` (so với v${row.comparison.previousVersion})`}
              </p>
              {!row.comparison ? (
                <p className="text-xs text-muted-foreground">Đây là snapshot đầu tiên — chưa có dữ liệu cũ để so sánh.</p>
              ) : row.comparison.metrics.length === 0 ? (
                <p className="text-xs text-muted-foreground">Không có địa điểm nào chung giữa hai snapshot để so sánh.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Chỉ số</TableHead>
                      <TableHead>TB cũ</TableHead>
                      <TableHead>TB mới</TableHead>
                      <TableHead>Thay đổi</TableHead>
                      <TableHead>Số zip đổi &gt;10%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {row.comparison.metrics.map((m) => (
                      <TableRow key={m.metric}>
                        <TableCell className="font-mono text-xs">{m.metric}</TableCell>
                        <TableCell>
                          {m.previousAvg.toFixed(2)} {m.unit}
                        </TableCell>
                        <TableCell>
                          {m.currentAvg.toFixed(2)} {m.unit}
                        </TableCell>
                        <TableCell
                          className={
                            m.percentChange === null ? "text-muted-foreground" : m.percentChange >= 0 ? "text-green-700" : "text-red-700"
                          }
                        >
                          {formatPercentChange(m.percentChange)}
                        </TableCell>
                        <TableCell>
                          {m.significantChangeCount} / {m.sampleSize}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nguồn</TableHead>
                <TableHead>Phiên bản</TableHead>
                <TableHead>Thời gian lấy dữ liệu</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Cổng xác thực</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshots.map((snap) => {
                const run = snap.validationRuns[0];
                return (
                  <TableRow key={snap.id}>
                    <TableCell>{snap.source.name}</TableCell>
                    <TableCell>v{snap.version}</TableCell>
                    <TableCell className="text-muted-foreground">{snap.fetchedAt.toLocaleString()}</TableCell>
                    <TableCell>
                      <SnapshotStatusBadge status={snap.status} />
                    </TableCell>
                    <TableCell>
                      {run ? (
                        run.batchGatePassed ? (
                          <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">
                            ĐẠT (chặn {(run.blockRate * 100).toFixed(1)}%)
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-red-100 text-red-800 hover:bg-red-100">
                            KHÔNG ĐẠT (chặn {(run.blockRate * 100).toFixed(1)}%)
                          </Badge>
                        )
                      ) : (
                        <span className="text-muted-foreground text-xs">chưa xác thực</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/collector/${snap.id}`} className="text-sm underline">
                        Chi tiết
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
              {snapshots.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Chưa có snapshot nào.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
