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

export type PublisherTab = "overview" | "gsc" | "ga" | "schema" | "analysis" | "posts" | "templates";

/**
 * BẢY tab, không phải mười.
 *
 * Mười tab tràn sang hàng thứ hai, và một thanh điều hướng hai hàng thì hàng
 * dưới bị đọc như thứ yếu dù không ai định thế. Ba mục gộp vào nơi chúng
 * thuộc về:
 *
 *   Tạo bài viết   -> trong Bài viết   (viết bài là một việc CỦA bài viết)
 *   OnPage         -> trong Bài viết   (soi chất lượng chính những trang đó)
 *   Theo dõi index -> trong GSC        (index là chuyện của Search Console)
 *
 * Đường dẫn cũ GIỮ NGUYÊN — /articles, /onpage, /index-log vẫn chạy. Gộp là
 * chuyện của điều hướng, không phải của URL: một liên kết đã lưu hay đã chia
 * sẻ không được hỏng vì ai đó sắp xếp lại menu.
 */
const TABS: { id: PublisherTab; label: string; path: (id: string) => string }[] = [
  { id: "overview", label: "Tổng quan", path: (id) => `/publisher/${id}` },
  { id: "gsc", label: "GSC", path: (id) => `/publisher/${id}/gsc` },
  { id: "ga", label: "GA4", path: (id) => `/publisher/${id}/ga` },
  { id: "schema", label: "Schema Graph", path: (id) => `/publisher/${id}/schema` },
  { id: "analysis", label: "Phân tích Data", path: (id) => `/publisher/${id}/analysis` },
  { id: "posts", label: "Bài viết", path: (id) => `/publisher/${id}/posts` },
  { id: "templates", label: "Template", path: (id) => `/publisher/${id}/templates` },
];

/**
 * Thanh tab PHỤ, bên trong một tab chính.
 *
 * Gộp mà xếp chồng hết nội dung lên một trang thì "gọn" ở menu và rối ở thân
 * trang — đổi một vấn đề lấy một vấn đề. Tab phụ giữ mỗi màn hình đúng một
 * việc, và giữ nguyên được đường dẫn cũ.
 */
export function PublisherSubTabs({
  items,
  active,
}: {
  items: { id: string; label: string; href: string }[];
  active: string;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t) =>
        t.id === active ? (
          <span key={t.id} className="rounded-lg bg-muted px-3 py-1.5 text-sm font-medium">
            {t.label}
          </span>
        ) : (
          <Link
            key={t.id}
            href={t.href}
            className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t.label}
          </Link>
        )
      )}
    </div>
  );
}

/** Tab phụ của "Bài viết" — một định nghĩa, ba trang dùng. */
export function postsSubTabs(websiteId: string) {
  return [
    { id: "posts", label: "Bài đã đăng", href: `/publisher/${websiteId}/posts` },
    { id: "articles", label: "Tạo bài viết", href: `/publisher/${websiteId}/articles` },
    { id: "onpage", label: "OnPage", href: `/publisher/${websiteId}/onpage` },
  ];
}

/** Tab phụ của "GSC". */
export function gscSubTabs(websiteId: string) {
  return [
    { id: "gsc", label: "Chỉ số tìm kiếm", href: `/publisher/${websiteId}/gsc` },
    { id: "index-log", label: "Theo dõi index", href: `/publisher/${websiteId}/index-log` },
  ];
}

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
