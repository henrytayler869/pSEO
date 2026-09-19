import Link from "next/link";

/**
 * Thanh tab của trang chi tiết publisher — MỘT định nghĩa.
 *
 * Trước đây danh sách này được chép nguyên vào sáu trang. Thêm một tab nghĩa
 * là sửa sáu chỗ, và chỗ thứ sáu bị quên thì tab mới đơn giản là KHÔNG tồn
 * tại ở trang đó — không lỗi, không cảnh báo, chỉ là người dùng đứng ở trang
 * này thì thấy còn đứng ở trang kia thì không. Đúng kiểu hỏng mà chỉ người
 * dùng phát hiện ra.
 *
 * `active` là id chứ không phải đường dẫn: một trang tự khai mình là tab nào
 * thì không phụ thuộc vào việc URL có dấu / ở cuối hay không.
 */

export type PublisherTab =
  | "overview"
  | "gsc"
  | "ga"
  | "schema"
  | "analysis"
  | "onpage"
  | "posts"
  | "articles"
  | "index-log"
  | "templates";

const TABS: { id: PublisherTab; label: string; path: (id: string) => string }[] = [
  { id: "overview", label: "Tổng quan", path: (id) => `/publisher/${id}` },
  { id: "gsc", label: "GSC", path: (id) => `/publisher/${id}/gsc` },
  { id: "ga", label: "GA4", path: (id) => `/publisher/${id}/ga` },
  { id: "schema", label: "Schema Graph", path: (id) => `/publisher/${id}/schema` },
  { id: "analysis", label: "Phân tích Data", path: (id) => `/publisher/${id}/analysis` },
  { id: "onpage", label: "OnPage", path: (id) => `/publisher/${id}/onpage` },
  { id: "posts", label: "Bài viết", path: (id) => `/publisher/${id}/posts` },
  { id: "articles", label: "Tạo bài viết", path: (id) => `/publisher/${id}/articles` },
  { id: "index-log", label: "Theo dõi index", path: (id) => `/publisher/${id}/index-log` },
  { id: "templates", label: "Template", path: (id) => `/publisher/${id}/templates` },
];

export function PublisherTabs({ websiteId, active }: { websiteId: string; active: PublisherTab }) {
  return (
    <div className="flex flex-wrap gap-1 border-b">
      {TABS.map((t) =>
        t.id === active ? (
          <span key={t.id} className="border-b-2 border-foreground px-3 py-2 text-sm font-medium">
            {t.label}
          </span>
        ) : (
          <Link
            key={t.id}
            href={t.path(websiteId)}
            className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {t.label}
          </Link>
        )
      )}
    </div>
  );
}
