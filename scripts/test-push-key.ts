import { pushKeyToSite, isHeaderSafeSecret } from "@/lib/publisher/push-key";

/**
 * Chạy: node_modules/.bin/tsx scripts/test-push-key.ts
 *
 * Thứ đáng kiểm ở đây không phải "gọi được HTTP không" mà là ĐỌC phản hồi:
 * một 200 không mang cờ xác nhận phải là THẤT BẠI. Báo thành công cho một
 * lần đẩy hụt sẽ khiến người ta thu hồi khoá cũ và làm chết site — nên mọi
 * ca dưới đây đều xoay quanh đúng chỗ đó.
 */

const KEY = "pseo_" + "a1b2c3d4".repeat(6);
const site = { url: "https://site.example/", revalidateSecret: "secret-ascii-9f3a" };

let pass = 0;
const fail: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const realFetch = globalThis.fetch;
type Captured = { url: string; headers: Record<string, string>; body: string };
let captured: Captured | null = null;

function stub(respond: () => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    captured = { url: String(input), headers, body: String(init?.body ?? "") };
    return respond();
  }) as typeof fetch;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function main() {
  // ---- secret hợp lệ cho header ----
  check("ascii thường là hợp lệ", isHeaderSafeSecret("abc-123_XY"));
  check("chuỗi rỗng không hợp lệ", !isHeaderSafeSecret(""));
  check("CHỮ CÓ DẤU không hợp lệ", !isHeaderSafeSecret("bí-mật"), "header HTTP không mang được, new Request() ném TypeError");
  check("khoảng trắng không hợp lệ", !isHeaderSafeSecret("hai chữ"));
  check("xuống dòng không hợp lệ", !isHeaderSafeSecret("abc\ndef"), "cho qua là mở đường tiêm header");

  // ---- chưa đủ điều kiện đẩy ----
  let r = await pushKeyToSite({ url: site.url, revalidateSecret: null }, KEY);
  check("không có secret → không thử gọi", !r.attempted && !r.ok);
  check("và nói rõ phải đặt secret trước", r.detail.includes("revalidate secret"), r.detail);

  r = await pushKeyToSite({ url: site.url, revalidateSecret: "bí-mật" }, KEY);
  check("secret có dấu → chặn TRƯỚC khi gọi", !r.attempted && !r.ok, "để lỗi không nổ ở tầng undici");

  // ---- đường thành công ----
  stub(() => json({ ok: true, keyFile: "/srv/site/.hq-key", source: "pushed" }));
  r = await pushKeyToSite(site, KEY);
  check("site xác nhận ghi → ok", r.ok, r.detail);
  check("gọi đúng endpoint, không nhân đôi dấu /", captured?.url === "https://site.example/api/hq-key", captured?.url ?? "");
  check("secret đi trong header", captured?.headers["x-revalidate-secret"] === site.revalidateSecret);
  check("khoá đi trong body, KHÔNG trong URL", captured!.body.includes(KEY) && !captured!.url.includes(KEY),
    "khoá trong URL sẽ nằm trong access log và referrer");

  // ---- 200 nhưng KHÔNG xác nhận: phần cốt lõi ----
  stub(() => json({ ok: false, error: "không ghi được" }));
  r = await pushKeyToSite(site, KEY);
  check("200 mà ok:false → THẤT BẠI", !r.ok, r.detail);

  stub(() => json({ message: "hello" }));
  r = await pushKeyToSite(site, KEY);
  check("200 mà thiếu cờ ok → THẤT BẠI", !r.ok, "200 không kèm xác nhận là 200 của thứ khác");

  stub(() => new Response("<html>OK</html>", { status: 200, headers: { "content-type": "text/html" } }));
  r = await pushKeyToSite(site, KEY);
  check("200 mà không phải JSON → THẤT BẠI", !r.ok, "trang lỗi tuỳ biến của proxy cũng trả 200");

  // ---- các mã lỗi ----
  stub(() => json({ error: "Unauthorized." }, 401));
  r = await pushKeyToSite(site, KEY);
  check("401 → thất bại, kèm lý do từ site", !r.ok && r.detail.includes("Unauthorized"), r.detail);

  stub(() => new Response("Not Found", { status: 404 }));
  r = await pushKeyToSite(site, KEY);
  check("404 → nói rõ site chưa deploy endpoint", !r.ok && r.detail.includes("chưa có endpoint"), r.detail);

  stub(() => json({ error: "Ghi xong nhưng đọc lại không khớp — khoá CHƯA đổi." }, 500));
  r = await pushKeyToSite(site, KEY);
  check("500 → chuyển nguyên lý do của site lên", !r.ok && r.detail.includes("CHƯA đổi"), r.detail);

  stub(() => {
    throw new Error("getaddrinfo ENOTFOUND");
  });
  r = await pushKeyToSite(site, KEY);
  check("mạng hỏng → thất bại có nêu địa chỉ", !r.ok && r.detail.includes("api/hq-key"), r.detail);

  // ---- ĐẨY QUA SITE ANH EM ----
  //
  // Phần đáng canh nhất ở đây KHÔNG phải "gọi được không" mà là HAI THỨ ĐI HAI
  // ĐƯỜNG: yêu cầu bay tới host trung chuyển, còn host đích đi trong body. Lẫn
  // hai thứ đó là một lỗi im lặng hoàn toàn — site trung chuyển trả 200 và ghi
  // khoá cho CHÍNH NÓ, tức vừa làm site đang sống dùng khoá của site khác, vừa
  // báo thành công cho một lần đẩy chưa tới đích.
  const target = { url: "https://moi.example/", revalidateSecret: null };
  const courier = { url: "https://dangsong.example/", revalidateSecret: "secret-cua-site-anh-em" };

  stub(() => json({ ok: true, keyFile: "/srv/site/.hq-key", source: "pushed" }));
  r = await pushKeyToSite(target, KEY, courier);
  check("site đích không có secret vẫn đẩy được QUA site anh em", r.ok, r.detail);
  check("gọi tới host TRUNG CHUYỂN", captured?.url === "https://dangsong.example/api/hq-key", captured?.url ?? "");
  check("dùng secret của site TRUNG CHUYỂN", captured?.headers["x-revalidate-secret"] === courier.revalidateSecret);
  check("host ĐÍCH đi trong body", JSON.parse(captured!.body).host === "moi.example", captured!.body);
  check("báo cáo nói rõ đã đi qua đâu", r.detail.includes("dangsong.example"), r.detail);
  check("và nói rõ khoá cấp cho host nào", r.detail.includes("moi.example"), r.detail);

  // Đối chứng dương cho phép kiểm trên: đường thẳng KHÔNG được nói "đi qua".
  // Thiếu ca này thì một `detail` luôn chứa chữ đó cũng đạt.
  stub(() => json({ ok: true, keyFile: "/srv/site/.hq-key" }));
  r = await pushKeyToSite(site, KEY);
  check("đường thẳng không nói 'đi qua'", r.ok && !r.detail.includes("đi qua"), r.detail);

  // Secret của site trung chuyển cũng phải qua phép kiểm header. Bỏ sót nhánh
  // này thì lỗi nổ ở tầng undici SAU khi khoá đã được sinh ra.
  r = await pushKeyToSite(target, KEY, { url: courier.url, revalidateSecret: "bí-mật" });
  check("secret trung chuyển có dấu → chặn TRƯỚC khi gọi", !r.attempted && !r.ok, r.detail);

  // Site trung chuyển từ chối thì đây là THẤT BẠI, không âm thầm quay về đẩy
  // thẳng. Một đường vận chuyển bí mật tự đổi đích khi gặp lỗi là thứ không ai
  // truy được về sau.
  stub(() => json({ error: "Unauthorized." }, 401));
  r = await pushKeyToSite(target, KEY, courier);
  check("trung chuyển trả 401 → thất bại, KHÔNG tự thử đường khác", !r.ok, r.detail);
  check("và vẫn gọi đúng host trung chuyển, không đổi sang host đích",
    captured?.url === "https://dangsong.example/api/hq-key", captured?.url ?? "");

  globalThis.fetch = realFetch;
  console.log(fail.length ? `\n✗ ${fail.length} trượt:\n  ${fail.join("\n  ")}\n` : "");
  console.log(`${pass}/${pass + fail.length} đạt.`);
  process.exit(fail.length ? 1 : 0);
}

void main();
