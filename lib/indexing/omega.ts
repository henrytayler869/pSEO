import { getCredential } from "@/lib/settings/credentials";

/**
 * Gửi URL tới Omega Indexer.
 *
 * Hợp đồng đọc từ trang tích hợp của họ 13/9/2026:
 *
 *   POST https://app.omegaindexer.com/api/omega-indexer-api
 *   { apikey, campaignname, urls: "a|b|c", dripfeed: "7" }
 *   -> 200, thân phản hồi là chuỗi "done"
 *
 * Ba giới hạn của API này định hình mọi thứ ở đây, và cần biết trước khi tin
 * vào bất cứ con số nào:
 *
 * 1. Phản hồi KHÔNG có campaign id và KHÔNG có trạng thái từng URL. Gửi 100
 *    URL mà 3 cái bị họ từ chối thì phản hồi vẫn là "done". Nên đây là gửi
 *    một chiều, không phải một giao dịch có biên nhận.
 *
 * 2. Không có endpoint đọc trạng thái. Họ để việc đó ở dashboard và MCP.
 *    Nghĩa là câu "URL này đã index chưa" phải hỏi GOOGLE, không hỏi họ —
 *    và đó cũng là câu hỏi đúng, vì thứ cần biết là Google nghĩ gì.
 *
 * 3. Mọi giá trị là chuỗi, kể cả `dripfeed`. Gửi số sẽ hỏng theo cách API
 *    không nói ra.
 */

const ENDPOINT = "https://app.omegaindexer.com/api/omega-indexer-api";
export const OMEGA_CREDENTIAL = "OMEGA_INDEXER_API_KEY";

/** Họ ghi tối đa 30 ngày. Vượt quá thì API không nói gì, nên chặn ở đây. */
const MAX_DRIPFEED_DAYS = 30;

export interface OmegaResult {
  ok: boolean;
  submitted: number;
  detail: string;
}

export async function submitToOmega(params: {
  urls: string[];
  campaignName: string;
  dripfeedDays: number;
}): Promise<OmegaResult> {
  const apikey = await getCredential(OMEGA_CREDENTIAL);
  if (!apikey) {
    return { ok: false, submitted: 0, detail: `Chưa cấu hình ${OMEGA_CREDENTIAL} trong Cài đặt.` };
  }
  if (params.urls.length === 0) return { ok: false, submitted: 0, detail: "Không có URL nào để gửi." };
  if (params.dripfeedDays < 1 || params.dripfeedDays > MAX_DRIPFEED_DAYS) {
    return { ok: false, submitted: 0, detail: `dripfeed phải từ 1 đến ${MAX_DRIPFEED_DAYS} ngày.` };
  }

  // URL chứa dấu "|" sẽ phá cách phân tách của họ và biến một URL thành hai.
  // Từ chối cả lô thay vì gửi một lô đã hỏng — một URL cụt vẫn tiêu credit và
  // không ai biết nó cụt.
  const bad = params.urls.filter((u) => u.includes("|"));
  if (bad.length > 0) {
    return { ok: false, submitted: 0, detail: `URL chứa ký tự "|" nên không gửi được: ${bad[0]}` };
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey,
        campaignname: params.campaignName,
        urls: params.urls.join("|"),
        dripfeed: String(params.dripfeedDays),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return { ok: false, submitted: 0, detail: err instanceof Error ? err.message : "không gọi được" };
  }

  const body = (await res.text()).trim();
  if (!res.ok) return { ok: false, submitted: 0, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };

  // Chỉ coi là thành công khi thân phản hồi đúng là "done". Một 200 với thân
  // khác nghĩa là hợp đồng đã đổi, và coi mọi 200 là thành công sẽ biến một
  // lần đổi API thành hàng trăm URL tưởng đã gửi mà chưa.
  const done = body.replace(/^"|"$/g, "").toLowerCase() === "done";
  if (!done) {
    return { ok: false, submitted: 0, detail: `200 nhưng thân phản hồi lạ (hợp đồng đã đổi?): ${body.slice(0, 200)}` };
  }

  return { ok: true, submitted: params.urls.length, detail: `đã gửi ${params.urls.length} URL, drip ${params.dripfeedDays} ngày` };
}
