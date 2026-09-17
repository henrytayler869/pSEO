/**
 * Đẩy khoá API mới sang publisher, để đổi khoá là một nút bấm ở đây chứ
 * không phải SSH vào VPS + sửa `.env.production` + restart service.
 *
 * Cùng kênh và cùng secret với notifySiteConfigChanged: publisher đã tin
 * `x-revalidate-secret` rồi. Khác một điểm quan trọng — lần đẩy này KHÔNG
 * được phép "hỏng nhưng vẫn báo ok". Một thiết lập GA4 đẩy hụt thì mất vài
 * ngày analytics; một khoá đẩy hụt mà báo thành công sẽ khiến người ta thu
 * hồi khoá cũ và làm chết site.
 */

/**
 * Header HTTP chỉ mang được ASCII.
 *
 * Không phải chuyện lý thuyết: `new Request()` ném TypeError ngay khi secret
 * có một ký tự > 255 — đo được lúc viết phép kiểm cho endpoint bên publisher,
 * với secret tiếng Việt có dấu. Lỗi đó nổ ở phía ĐẨY, cách xa ô nhập đã sinh
 * ra nó, và thông báo của nó ("character at index 4 has a value of 7853")
 * không chỉ về đâu cả.
 */
export function isHeaderSafeSecret(value: string): boolean {
  return value.length > 0 && /^[\x21-\x7e]+$/.test(value);
}

export type PushKeyResult = {
  attempted: boolean;
  ok: boolean;
  /** Câu để hiện ngay cạnh nút. */
  detail: string;
};

export async function pushKeyToSite(
  website: { url: string; revalidateSecret: string | null },
  key: string
): Promise<PushKeyResult> {
  if (!website.revalidateSecret) {
    return {
      attempted: false,
      ok: false,
      detail:
        "Chưa có revalidate secret cho site này nên không đẩy khoá sang được. Đặt secret ở thẻ bên dưới trước, rồi tạo lại khoá.",
    };
  }

  if (!isHeaderSafeSecret(website.revalidateSecret)) {
    return {
      attempted: false,
      ok: false,
      detail:
        "Revalidate secret của site này có ký tự ngoài ASCII (chữ có dấu, khoảng trắng…) nên không đặt vào header HTTP được. Đổi secret sang chữ/số/dấu gạch rồi tạo lại khoá.",
    };
  }

  const endpoint = `${website.url.replace(/\/+$/, "")}/api/hq-key`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-revalidate-secret": website.revalidateSecret,
      },
      // host đi kèm: từ khi publisher giữ khoá theo từng host, một lần đẩy
      // không nói rõ host sẽ ghi vào site đầu tiên trong bảng — đúng cho một
      // site, sai lặng lẽ từ site thứ hai.
      body: JSON.stringify({ key, host: new URL(website.url).hostname.replace(/^www\./, "") }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (e) {
    return {
      attempted: true,
      ok: false,
      detail: `Không gọi được ${endpoint}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (res.status === 404) {
    return {
      attempted: true,
      ok: false,
      detail: `${endpoint} trả 404 — bản đang chạy của site chưa có endpoint nhận khoá. Deploy site rồi tạo lại khoá.`,
    };
  }

  const text = await res.text();
  if (!res.ok) {
    let reason = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) reason = parsed.error;
    } catch {
      // giữ nguyên text thô
    }
    return { attempted: true, ok: false, detail: `Site từ chối (HTTP ${res.status}): ${reason}` };
  }

  // 200 chưa đủ. Endpoint bên publisher ghi file rồi ĐỌC LẠI để xác nhận, và
  // chỉ khi đó mới trả `ok: true`. Một 200 không mang cờ đó là 200 của thứ
  // khác — proxy, trang lỗi tuỳ biến, phiên bản cũ của route.
  let body: { ok?: boolean; keyFile?: string; source?: string };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return { attempted: true, ok: false, detail: `Site trả 200 nhưng không phải JSON: ${text.slice(0, 200)}` };
  }

  if (body.ok !== true) {
    return { attempted: true, ok: false, detail: `Site trả 200 nhưng không xác nhận đã ghi: ${text.slice(0, 200)}` };
  }

  return { attempted: true, ok: true, detail: `Đã đẩy sang site và site xác nhận ghi vào ${body.keyFile ?? "file khoá"}.` };
}
