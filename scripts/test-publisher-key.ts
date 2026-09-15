import { mintKey, hashKey, prefixOf, hashesMatch, judgeScope, KEY_PREFIX, PREFIX_LEN, type ApiCaller } from "@/lib/api/publisher-key";

let pass = 0;
const fail: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const site: ApiCaller = { keyId: "k1", websiteId: "w1", websiteName: "AT Moving", vertical: "moving-services" };
const legacy: ApiCaller = { keyId: "k0", websiteId: null, websiteName: null, vertical: null };

// ---- sinh khoá ----
const a = mintKey();
const b = mintKey();
check("hai lần sinh ra hai khoá khác nhau", a.key !== b.key);
check("khoá mang tiền tố nhận dạng", a.key.startsWith(KEY_PREFIX));
check("prefix lưu đúng bằng đầu khoá", a.key.slice(0, PREFIX_LEN) === a.keyPrefix);
check("băm lưu khớp băm tính lại", hashKey(a.key) === a.keyHash);
check("KHÓA KHÔNG NẰM TRONG THỨ ĐEM LƯU", !a.keyHash.includes(a.key.slice(PREFIX_LEN)) && !a.keyPrefix.includes(a.key.slice(PREFIX_LEN)));

// ---- prefixOf: loại rác trước khi chạm database ----
check("header rỗng bị loại", prefixOf("") === null);
check("null bị loại", prefixOf(null) === null);
check("chuỗi không đúng tiền tố bị loại", prefixOf("sk-live-abcdef") === null);
check("khoá đúng tiền tố nhưng cụt bị loại", prefixOf(KEY_PREFIX + "abc") === null);
check("khoá đúng tiền tố nhưng dài quá bị loại", prefixOf(a.key + "00") === null);
check("khoá hợp lệ trả đúng prefix", prefixOf(a.key) === a.keyPrefix);

// ---- so băm ----
check("băm đúng thì khớp", hashesMatch(hashKey(a.key), a.keyHash));
check("băm của khoá khác thì không khớp", !hashesMatch(hashKey(b.key), a.keyHash));
check("băm rỗng không khớp với chính nó", !hashesMatch("", ""));
check("băm sai độ dài không khớp", !hashesMatch("abcd", a.keyHash));

// ---- phạm vi ----
check("đúng niche thì cho", judgeScope(site, { vertical: "moving-services" }).ok);
check("SAI NICHE THÌ CHẶN", !judgeScope(site, { vertical: "auto-accident-attorney" }).ok);
const denied = judgeScope(site, { vertical: "auto-accident-attorney" });
check(
  "lý do chặn nêu cả publisher lẫn niche bị từ chối",
  !denied.ok && denied.reason.includes("AT Moving") && denied.reason.includes("auto-accident-attorney"),
  !denied.ok ? denied.reason : ""
);
check("no-scope thì cho", judgeScope(site, "no-scope").ok);
check("host đã đối chiếu khớp thì cho", judgeScope(site, { host: "atmovingservices.com" }, true).ok);
check("host đối chiếu KHÔNG khớp thì chặn", !judgeScope(site, { host: "example.com" }, false).ok);
check(
  "CHƯA ĐỐI CHIẾU host thì TỪ CHỐI, không phải cho qua",
  !judgeScope(site, { host: "example.com" }).ok,
  "undefined phải đọc là chưa biết, và chưa biết thì không mở cửa"
);

// ---- khoá dùng chung cũ ----
check("khoá cũ vẫn đọc được mọi niche (lý do nó phải chết)", judgeScope(legacy, { vertical: "bất-kỳ-cái-gì" }).ok);
check("khoá cũ vẫn đọc được mọi host", judgeScope(legacy, { host: "example.com" }).ok);

// ---- va chạm prefix ----
const prefixes = new Set<string>();
for (let i = 0; i < 2000; i++) prefixes.add(mintKey().keyPrefix);
check("2000 khoá sinh ra 2000 prefix khác nhau", prefixes.size === 2000, `thấy ${prefixes.size}`);

console.log(fail.length ? `\n✗ ${fail.length} trượt:\n  ${fail.join("\n  ")}\n` : "");
console.log(`${pass}/${pass + fail.length} đạt.`);
process.exit(fail.length ? 1 : 0);
