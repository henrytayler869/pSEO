import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";
import { Suspense } from "react";
import { loginRequired } from "@/lib/auth/session";
import { DevHealthBanner } from "@/components/dev-health-banner";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bảng điều khiển pSEO",
  description: "Bảng điều khiển nội bộ cho pipeline pSEO.",
};

/**
 * Băng-rôn sức khoẻ CHỈ ở dev.
 *
 * Trên VPS, Postgres và WordPress đều là loopback thật — không có tunnel nào
 * để đứt, nên câu hỏi này ở production không có nghĩa. Kiểm bằng NODE_ENV chứ
 * không bằng hostname: hostname đúng ở máy này và sai ở máy kế tiếp.
 */
async function DevHealth() {
  if (process.env.NODE_ENV === "production") return null;
  const { devHealth } = await import("@/lib/dev/health");
  const checks = await devHealth();
  return <DevHealthBanner checks={checks} />;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      className={`${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-muted">
        <TooltipProvider>
          <div className="flex min-h-screen flex-col">
            <Suspense fallback={null}>
              <DevHealth />
            </Suspense>
            <div className="flex flex-1">
            <Sidebar showLogout={loginRequired()} />
            <main className="min-w-0 flex-1 px-8 py-8">
              <div className="mx-auto w-full max-w-6xl">{children}</div>
            </main>
            </div>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
