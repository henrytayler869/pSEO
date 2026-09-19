import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Share2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { PublisherTabs } from "@/components/publisher-tabs";
import { prisma } from "@/lib/db/prisma";
import { buildSchemaGraph } from "@/lib/publisher/schema-graph";

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

  const graph = await buildSchemaGraph(website.url, website.vertical);

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
        description="Các node JSON-LD có NỐI ĐƯỢC vào nhau không. Khác với cổng kiểm cú pháp: một node hợp lệ mà thiếu @id vẫn qua mọi phép kiểm, và vẫn là một hòn đảo."
      />

      <Card>
        <CardHeader>
          <CardTitle>Mẫu đã soi</CardTitle>
          <CardDescription>
            Đồ thị schema là thuộc tính của KHUÔN trang, không phải của từng trang — 127 trang thị trường sinh từ cùng
            một component nên cùng hình dạng. Quét cả site tốn 158 request để trả lời câu mà {graph.sampled.length} request
            đã trả lời.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Khuôn</th>
                <th className="py-1 pr-3">Đường dẫn</th>
                <th className="py-1">Node JSON-LD</th>
              </tr>
            </thead>
            <tbody>
              {graph.sampled.map((s) => (
                <tr key={s.path} className="border-t">
                  <td className="py-1 pr-3">{s.kind}</td>
                  <td className="py-1 pr-3 font-mono">{s.path}</td>
                  <td className="py-1">
                    {s.blocks === null ? (
                      <span className="text-destructive">không soi được — {s.error}</span>
                    ) : s.blocks === 0 ? (
                      <span className="text-destructive">0 — trang này không phát JSON-LD nào</span>
                    ) : (
                      s.blocks
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {graph.notSampled.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-500">
              Khuôn CHƯA được soi: {graph.notSampled.join(", ")}. Bản đồ dưới đây không nói gì về chúng.
            </p>
          )}
        </CardContent>
      </Card>

      {(graph.islands.length > 0 || graph.dangling.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Chỗ đứt nối</CardTitle>
            <CardDescription>
              Đây là thứ mà cổng kiểm cú pháp không bắt: schema vẫn hợp lệ, trình đọc vẫn nhận, và liên kết thì không
              tồn tại.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {graph.islands.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Node không có @id — không gì tham chiếu tới được</h3>
                <ul className="mt-1 flex flex-col gap-1 text-xs">
                  {graph.islands.map((n) => (
                    <li key={n.type}>
                      <code className="font-mono">{n.type}</code> — thấy trên {n.seenOn.length} khuôn (
                      {n.seenOn.slice(0, 3).join(", ")}
                      {n.seenOn.length > 3 ? "…" : ""})
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
                      <code className="font-mono">{e.fromType}</code> →{" "}
                      <code className="font-mono">{e.property}</code> → <code className="font-mono">{shortId(e.toId)}</code>{" "}
                      <span className="text-muted-foreground">({e.seenOn.length} khuôn)</span>
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
          <CardTitle>Node</CardTitle>
          <CardDescription>Loại schema nào có mặt, và trên bao nhiêu khuôn trang.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">@type</th>
                <th className="py-1 pr-3">@id</th>
                <th className="py-1">Khuôn</th>
              </tr>
            </thead>
            <tbody>
              {graph.nodes.map((n) => (
                <tr key={`${n.type}-${n.id ?? ""}`} className="border-t">
                  <td className="py-1 pr-3 font-mono">{n.type}</td>
                  <td className={`py-1 pr-3 font-mono ${n.id ? "" : "text-destructive"}`}>{shortId(n.id)}</td>
                  <td className="py-1 text-muted-foreground">{n.seenOn.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liên kết</CardTitle>
          <CardDescription>Node nào trỏ tới node nào, qua thuộc tính nào.</CardDescription>
        </CardHeader>
        <CardContent>
          {graph.edges.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Không có cạnh nào — mọi node đều đứng rời. Với một @graph thì đó là dấu hiệu nó chưa thật sự là một đồ thị.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Từ</th>
                  <th className="py-1 pr-3">Thuộc tính</th>
                  <th className="py-1 pr-3">Tới</th>
                  <th className="py-1">Giải được</th>
                </tr>
              </thead>
              <tbody>
                {graph.edges.map((e) => (
                  <tr key={`${e.fromType}-${e.property}-${e.toId}`} className="border-t">
                    <td className="py-1 pr-3 font-mono">{e.fromType}</td>
                    <td className="py-1 pr-3 font-mono">{e.property}</td>
                    <td className="py-1 pr-3 font-mono">{shortId(e.toId)}</td>
                    <td className={`py-1 ${e.resolved ? "text-muted-foreground" : "text-destructive"}`}>
                      {e.resolved ? "có" : "KHÔNG"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
