import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Share2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { PublisherTabs } from "@/components/publisher-tabs";
import { prisma } from "@/lib/db/prisma";
import { buildSchemaGraph } from "@/lib/publisher/schema-graph";
import { buildPageGraph } from "@/lib/publisher/page-graph";
import { SchemaMap } from "@/components/schema-map";
import { PageLinkMap } from "@/components/page-link-map";
import { InternalLinkMap, UnlinkedPages } from "@/components/internal-link-map";

function shortId(id: string | null): string {
  if (!id) return "—";
  const hash = id.indexOf("#");
  if (hash >= 0) return id.slice(hash);
  try {
    return new URL(id).pathname;
  } catch {
    return id;
  }
}

export default async function SchemaPage({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { id: true, name: true, url: true, vertical: true },
  });
  if (!website) notFound();

  const [graph, pages] = await Promise.all([
    buildSchemaGraph(website.url, website.vertical),
    buildPageGraph(website.url, website.vertical),
  ]);

  const linked = pages.total - pages.orphans.length - pages.noBreadcrumb.length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/publisher/${websiteId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại {website.name}
        </Link>
      </div>

      <PublisherTabs websiteId={websiteId} active="schema" />

      <PageHeader
        icon={Share2}
        title="Schema Graph"
        description="Trang nào nối với trang nào, và trang nào không ai trỏ tới. Liên kết trang↔trang trong schema nằm ở breadcrumb: mỗi trang tự khai chuỗi tổ tiên của nó, gộp lại thì ra cấu trúc Google đọc được."
      />

      <Card>
        <CardHeader>
          <CardTitle>Bản đồ liên kết trang</CardTitle>
          <CardDescription>
            Quét cả {pages.total} trang trong sitemap ({(pages.elapsedMs / 1000).toFixed(1)} giây).{" "}
            <strong>{linked}</strong> trang nằm trong cây,{" "}
            <strong className={pages.orphans.length > 0 ? "text-destructive" : undefined}>{pages.orphans.length}</strong> mồ
            côi, {pages.noBreadcrumb.length} không có breadcrumb.
            <br />
            Nút nhánh vẽ riêng, trang lá gộp thành số — 127 lá cùng một cha vẽ ra một đám mây không đọc được. Mồ côi thì
            KHÔNG gộp: nó là thứ duy nhất người ta mở tab này để tìm.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PageLinkMap graph={pages} />
        </CardContent>
      </Card>

      {/*
        Hình THỨ HAI, không thay hình thứ nhất.

        Hai câu khác nhau: cây breadcrumb nói trang NẰM Ở ĐÂU trong cấu trúc
        site tự khai; bản đồ này nói trang ĐƯỢC TRỎ TỚI từ đâu, bằng thẻ <a>
        thật. Google đi theo thẻ <a>. Một trang có breadcrumb hoàn hảo mà
        không ai đặt liên kết tới vẫn là trang phải chờ được chiếu cố.
      */}
      <Card>
        <CardHeader>
          <CardTitle>Cấu trúc liên kết nội bộ</CardTitle>
          <CardDescription>
            Liên kết THẬT giữa các trang và bài viết — thẻ <code>&lt;a href&gt;</code> trong HTML, không phải
            breadcrumb. Đọc từ cùng lần quét ở trên, nên không tốn thêm request nào.{" "}
            <strong>{pages.links.edges}</strong> liên kết nội bộ giữa {pages.total} trang.
            <br />
            Vẽ từng cạnh một thì 4.442 đường cho ra một búi tóc đen. Gộp theo LOẠI trang cho 8 điểm và khoảng 30
            đường — mỗi đường vẫn mang trọng số thật, chỉ là cộng lại chứ không cắt bớt.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <InternalLinkMap graph={pages} />
          <UnlinkedPages graph={pages} />
        </CardContent>
      </Card>

      {(pages.orphans.length > 0 || pages.noBreadcrumb.length > 0 || pages.failed.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Trang cần xử lý</CardTitle>
            <CardDescription>
              Mồ côi vẫn nằm trong sitemap, vẫn trả 200, vẫn được index — nhưng về cấu trúc nó treo lơ lửng, và không
              phép kiểm nào khác trong hệ này nhìn thấy điều đó.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {pages.orphans.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-destructive">Mồ côi — không breadcrumb nào trỏ tới</h3>
                <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
                  {pages.orphans.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
            )}
            {pages.noBreadcrumb.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Không phát BreadcrumbList — không tự khai tổ tiên</h3>
                <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
                  {pages.noBreadcrumb.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
            )}
            {pages.failed.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-destructive">Không soi được</h3>
                <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
                  {pages.failed.map((f) => (
                    <li key={f.path}>
                      {f.path} — {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(graph.islands.length > 0 || graph.dangling.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Chỗ đứt nối bên trong một trang</CardTitle>
            <CardDescription>
              Khác với mồ côi ở trên: đây là node hợp lệ mà không gì tham chiếu tới được. Cổng kiểm cú pháp không bắt.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {graph.islands.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Node không có @id</h3>
                <ul className="mt-1 flex flex-col gap-1 text-xs">
                  {graph.islands.map((n) => (
                    <li key={n.type}>
                      <code className="font-mono">{n.type}</code> — {n.seenOn.length} khuôn
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {graph.dangling.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Cạnh trỏ tới @id không có trong cùng trang</h3>
                <ul className="mt-1 flex flex-col gap-1 text-xs">
                  {graph.dangling.map((e) => (
                    <li key={`${e.fromType}-${e.property}-${e.toId}`}>
                      <code className="font-mono">{e.fromType}</code> → <code className="font-mono">{e.property}</code> →{" "}
                      <code className="font-mono">{shortId(e.toId)}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Cấu trúc schema bên trong một trang</CardTitle>
          <CardDescription>
            Hình này giống nhau trên mọi khuôn — nó nói các node trong MỘT trang nối với nhau ra sao, không nói trang
            nối với trang. Giữ lại vì nó là chỗ duy nhất thấy được node thiếu <code>@id</code> hoặc cạnh không giao
            được.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SchemaMap nodes={graph.nodes} edges={graph.edges} />
        </CardContent>
      </Card>
    </div>
  );
}
