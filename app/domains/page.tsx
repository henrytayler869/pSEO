import { Link2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AddDomainForm } from "@/components/add-domain-form";
import { RefreshDomainButton } from "@/components/refresh-domain-button";
import { RemoveDomainButton } from "@/components/remove-domain-button";
import { getDomains } from "@/lib/queries/domains";
import { getTrafficVerticalSummaries } from "@/lib/queries/traffic-research";

function StatusBadge({ status, error }: { status: string | null; error: string | null }) {
  if (error) {
    return (
      <Badge variant="secondary" className="bg-red-100 text-red-800 hover:bg-red-100">
        Lỗi
      </Badge>
    );
  }
  if (status === "active") {
    return (
      <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">
        Active
      </Badge>
    );
  }
  if (status === "pending" || status === "initializing") {
    return (
      <Badge variant="secondary" className="bg-orange-100 text-orange-800 hover:bg-orange-100">
        {status}
      </Badge>
    );
  }
  return <Badge variant="outline">{status ?? "Chưa rõ"}</Badge>;
}

export default async function DomainsPage() {
  // Cùng một nguồn với /api/v1/niches và với phần xác thực trong action —
  // ba chỗ hỏi "niche nào đã nghiên cứu" phải cùng nhận một câu trả lời, nếu
  // không thì dropdown sẽ mời một lựa chọn mà action từ chối.
  const [domains, nicheSummaries] = await Promise.all([getDomains(), getTrafficVerticalSummaries()]);
  const niches = nicheSummaries.map((n) => ({
    vertical: n.vertical,
    scoredMarketCount: n.scoredMarketCount,
    rank: n.rank,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Link2}
        title="Domain"
        description="Đăng ký domain thật đã mua vào hệ thống — domain đã là zone trên Cloudflare thì được NHẬP vào (không tạo mới, không đụng DNS đang chạy); chưa có zone thì tạo mới ngay lập tức. Không phải bản ghi giữ chỗ. Đây là bước trước Publisher: Publisher cần WordPress + GSC/GA4 đã verify, những thứ chỉ tồn tại sau khi domain đã có ở đây và DNS đã trỏ."
      />

      <Card>
        <CardHeader>
          <CardTitle>Domain đã đăng ký ({domains.length})</CardTitle>
          <CardDescription>
            Trạng thái (Active/Pending/Initializing) lấy trực tiếp từ Cloudflare tại thời điểm thêm hoặc lần &quot;Kiểm
            tra lại&quot; gần nhất — bấm &quot;Kiểm tra lại&quot; sau khi đã trỏ nameserver tại registrar để cập nhật.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AddDomainForm niches={niches} />
          {domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có domain nào.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Dùng cho niche</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Nameserver Cloudflare</TableHead>
                  <TableHead>Kiểm tra gần nhất</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      {d.relevantVertical ? <Badge variant="outline">{d.relevantVertical}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={d.cloudflareStatus} error={d.cloudflareError} />
                      {d.cloudflareError && <p className="mt-1 max-w-xs text-xs text-red-700">{d.cloudflareError}</p>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {d.nameServers.length > 0 ? d.nameServers.join(", ") : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {d.lastCheckedAt ? d.lastCheckedAt.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <RefreshDomainButton domainId={d.id} />
                        <RemoveDomainButton domainId={d.id} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
