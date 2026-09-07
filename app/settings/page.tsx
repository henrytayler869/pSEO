import { Settings } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { CredentialFieldRow } from "@/components/credential-field-row";
import { ApiKeyManager } from "@/components/api-key-manager";
import { ServiceAccountManager } from "@/components/service-account-manager";
import { CREDENTIAL_FIELDS, getCredentialStatuses, type CredentialField } from "@/lib/settings/credentials";
import { getApiKeyStatus } from "@/lib/settings/api-key";
import { getServiceAccountStatus } from "@/lib/google/service-account";

export default async function SettingsPage() {
  const statuses = await getCredentialStatuses();
  const statusByName = new Map(statuses.map((s) => [s.name, s]));
  const apiKeyStatus = await getApiKeyStatus();
  const serviceAccountStatus = await getServiceAccountStatus();

  const groups = new Map<string, CredentialField[]>();
  for (const field of CREDENTIAL_FIELDS) {
    const list = groups.get(field.group) ?? [];
    list.push(field);
    groups.set(field.group, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Settings}
        title="Cài đặt"
        description="Nhập API key/thông tin xác thực để từng module chuyển từ dữ liệu giả lập sang dữ liệu thật — không cần sửa file .env hay khởi động lại server. Giá trị lưu ở đây được ưu tiên hơn biến môi trường. Để trống một ô nghĩa là giữ nguyên giá trị hiện tại; bấm Lưu chỉ áp dụng cho ô bạn vừa nhập."
      />
      {[...groups.entries()].map(([group, fields]) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle>{group}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col">
            {fields.map((field) => {
              const status = statusByName.get(field.name);
              return (
                <CredentialFieldRow
                  key={field.name}
                  name={field.name}
                  label={field.label}
                  helpText={field.helpText}
                  secret={field.secret}
                  status={status?.source ?? "none"}
                  masked={status?.masked}
                />
              );
            })}
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>Cổng API (cho plugin/website)</CardTitle>
          <CardDescription>
            Expose dataset niche đã nghiên cứu (số liệu từ khóa, keyword chính, keyword semantic) qua API để website
            thật gọi vào — thay vì dựng trang ngay trong control panel này.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeyManager configured={apiKeyStatus.configured} masked={apiKeyStatus.masked} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Publisher (GSC + GA4 cho các website)</CardTitle>
          <CardDescription>
            1 Service Account dùng chung để đọc Search Console + Google Analytics 4 của mọi website kết nối ở tab
            Publisher — không cần OAuth riêng từng site, không hết hạn.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ServiceAccountManager configured={serviceAccountStatus.configured} clientEmail={serviceAccountStatus.clientEmail} />
        </CardContent>
      </Card>
    </div>
  );
}
