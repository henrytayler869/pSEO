"use client";

import { useActionState, useState } from "react";
import { Trash2, Plus, Save, KeyRound, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createPostAction,
  updatePostAction,
  trashPostAction,
  saveWpCredentialsAction,
  type PostActionResult,
} from "@/app/publisher/[websiteId]/posts/actions";

export interface PostRow {
  id: number;
  slug: string;
  status: string;
  title: string;
  content: string;
  link: string;
  modifiedAt: string;
}

const EMPTY: PostActionResult = { ok: false, message: "" };

/**
 * Every result message is rendered, success and failure alike.
 *
 * A form that only shows errors trains its user to read nothing when it works,
 * and then the one time "đã lưu" would have said something useful — that a
 * post went out as a draft rather than published, say — nobody is looking.
 */
function Result({ state }: { state: PostActionResult }) {
  if (!state.message) return null;
  return (
    <p className={`text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.message}</p>
  );
}

function CredentialsForm({ websiteId, username }: { websiteId: string; username: string | null }) {
  const [state, action, pending] = useActionState(saveWpCredentialsAction, EMPTY);
  const [open, setOpen] = useState(username === null);

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <KeyRound className="h-4 w-4" />
          {username ? (
            <span>
              Đang dùng tài khoản <span className="font-medium">{username}</span>
            </span>
          ) : (
            <span className="text-red-700">Chưa có Application Password — chỉ đọc được, không sửa được</span>
          )}
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Đóng" : username ? "Đổi" : "Thêm"}
        </Button>
      </div>

      {open && (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="websiteId" value={websiteId} />
          <p className="text-xs text-muted-foreground">
            Tạo ở <span className="font-mono">wp-admin → Users → Profile → Application Passwords</span>. Đó là mật khẩu
            riêng cho ứng dụng — thu hồi được mà không đổi mật khẩu đăng nhập, nên đừng dán mật khẩu tài khoản vào đây.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              name="wpUsername"
              defaultValue={username ?? ""}
              placeholder="Tên đăng nhập WordPress"
              className="rounded-md border px-2.5 py-1.5 text-sm"
              autoComplete="off"
            />
            <input
              name="wpAppPassword"
              type="password"
              placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              className="rounded-md border px-2.5 py-1.5 text-sm"
              autoComplete="off"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" variant="secondary" disabled={pending}>
              {pending ? "Đang lưu..." : "Lưu"}
            </Button>
            <Result state={state} />
          </div>
        </form>
      )}
    </div>
  );
}

function NewPostForm({ websiteId }: { websiteId: string }) {
  const [state, action, pending] = useActionState(createPostAction, EMPTY);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Bài viết mới
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2 rounded-lg border p-4">
      <input type="hidden" name="websiteId" value={websiteId} />
      <input name="title" placeholder="Tiêu đề" className="rounded-md border px-2.5 py-1.5 text-sm" />
      <textarea
        name="content"
        rows={8}
        placeholder="Nội dung (HTML hoặc block markup của WordPress)"
        className="rounded-md border px-2.5 py-1.5 font-mono text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        {/* Mặc định là BẢN NHÁP. Một nút tạo bài mặc định đăng ngay là một nút
            xuất bản ra internet trước khi ai kịp đọc lại. */}
        <select name="status" defaultValue="draft" className="rounded-md border px-2.5 py-1.5 text-sm">
          <option value="draft">Lưu nháp</option>
          <option value="publish">Đăng ngay</option>
        </select>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Đang tạo..." : "Tạo"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Huỷ
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

function PostEditor({
  websiteId,
  post,
  editable,
}: {
  websiteId: string;
  post: PostRow;
  editable: boolean;
}) {
  const [state, action, pending] = useActionState(updatePostAction, EMPTY);
  const [trashState, trashAction, trashing] = useActionState(trashPostAction, EMPTY);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={post.status === "publish" ? "default" : "outline"}>
            {post.status === "publish" ? "đã đăng" : post.status === "draft" ? "nháp" : post.status}
          </Badge>
          <span className="truncate text-sm font-medium">{post.title || "(không tiêu đề)"}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">/{post.slug}</span>
        </div>
        <div className="flex items-center gap-1">
          {post.link && (
            <a
              href={post.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 text-xs underline underline-offset-2"
            >
              Xem <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? "Đóng" : editable ? "Sửa" : "Xem nội dung"}
          </Button>
        </div>
      </div>

      {open && !editable && (
        /**
         * Chỉ ĐỌC, và nội dung hiển thị là bản ĐÃ RENDER.
         *
         * Không auth thì WordPress không trả `content.raw` — đo trên site thật
         * 2026-09-10: `raw` vắng mặt hoàn toàn. Cho sửa ô này rồi lưu lại sẽ
         * ghi đè nội dung gốc bằng HTML đã qua filter: shortcode đã nở ra,
         * block markup đã biến mất. Bài vẫn hiện đúng một lần, rồi không bao
         * giờ sửa lại được như cũ.
         *
         * Nên ô này disabled chứ không phải "cứ để họ thử rồi báo lỗi": lỗi
         * đến từ server sau khi người ta đã gõ xong.
         */
        <div className="flex flex-col gap-2">
          <p className="text-xs text-amber-700">
            Đây là nội dung ĐÃ RENDER, không phải bản gốc trong trình soạn thảo — WordPress chỉ trả bản gốc cho request
            có đăng nhập. Lưu bản này sẽ ghi đè shortcode và block markup bằng HTML đã nở ra. Thêm Application Password
            ở trên để sửa được thật.
          </p>
          <textarea
            readOnly
            rows={12}
            value={post.content}
            className="rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs"
          />
        </div>
      )}

      {open && editable && (
        <>
          <form action={action} className="flex flex-col gap-2">
            <input type="hidden" name="websiteId" value={websiteId} />
            <input type="hidden" name="id" value={post.id} />
            <input
              name="title"
              defaultValue={post.title}
              className="rounded-md border px-2.5 py-1.5 text-sm"
            />
            <textarea
              name="content"
              rows={12}
              defaultValue={post.content}
              className="rounded-md border px-2.5 py-1.5 font-mono text-xs"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                name="status"
                defaultValue={post.status === "publish" ? "publish" : "draft"}
                className="rounded-md border px-2.5 py-1.5 text-sm"
              >
                <option value="draft">Nháp</option>
                <option value="publish">Đăng</option>
              </select>
              <Button type="submit" size="sm" disabled={pending}>
                <Save className="h-3.5 w-3.5" /> {pending ? "Đang lưu..." : "Lưu"}
              </Button>
              <Result state={state} />
            </div>
          </form>

          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            {!confirming ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Chuyển vào thùng rác
              </Button>
            ) : (
              <form action={trashAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="websiteId" value={websiteId} />
                <input type="hidden" name="id" value={post.id} />
                {/* Nói rõ nó KHÔNG phải xoá vĩnh viễn. Một nút ghi "Xoá" mà thật
                    ra là thùng rác nói dối theo hướng an toàn; ngược lại thì
                    nói dối theo hướng mất bài. */}
                <span className="text-xs">
                  Chuyển <span className="font-medium">{post.title || post.slug}</span> vào thùng rác? Khôi phục được
                  trong wp-admin, không phải xoá vĩnh viễn.
                </span>
                <Button type="submit" size="sm" variant="destructive" disabled={trashing}>
                  {trashing ? "Đang chuyển..." : "Xác nhận"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Huỷ
                </Button>
              </form>
            )}
            <Result state={trashState} />
          </div>
        </>
      )}
    </div>
  );
}

export function WpPostsManager({
  websiteId,
  username,
  posts,
  sawAllStatuses,
  loadError,
}: {
  websiteId: string;
  username: string | null;
  posts: PostRow[];
  sawAllStatuses: boolean;
  loadError: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <CredentialsForm websiteId={websiteId} username={username} />

      {loadError && (
        <p className="text-sm text-red-700">
          Không đọc được WordPress: {loadError}
          <span className="block text-xs">
            HQ gọi WordPress qua loopback của VPS, nên từ máy khác sẽ luôn không tới được. Đây KHÔNG phải
            &ldquo;WordPress không có bài nào&rdquo; — chưa đọc được thì chưa biết. Trang site đang phục vụ nằm ở thẻ bên
            dưới, đọc từ nguồn khác.
          </span>
        </p>
      )}

      {!loadError && !sawAllStatuses && (
        <p className="text-xs text-muted-foreground">
          Danh sách này CHỈ gồm bài đã đăng. Bản nháp và bài trong thùng rác cần đăng nhập mới thấy — nên con số dưới
          đây có thể nhỏ hơn số bài thật sự có trong WordPress.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {/* Không in "0 bài" khi đọc hỏng.
            Con số 0 cạnh một dòng lỗi đọc thành "không có bài nào", tức là
            câu trả lời cho một câu hỏi chưa ai hỏi được. */}
        <span className="text-sm text-muted-foreground">
          {loadError ? "chưa đọc được số bài" : `${posts.length} bài`}
        </span>
        <NewPostForm websiteId={websiteId} />
      </div>

      {posts.length === 0 && !loadError ? (
        <p className="text-sm text-muted-foreground">Chưa có bài nào.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {posts.map((p) => (
            <PostEditor key={p.id} websiteId={websiteId} post={p} editable={sawAllStatuses} />
          ))}
        </div>
      )}
    </div>
  );
}
