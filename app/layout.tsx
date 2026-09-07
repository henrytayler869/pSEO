import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bảng điều khiển pSEO",
  description: "Bảng điều khiển nội bộ cho pipeline pSEO.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      className={`${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-muted">
        <TooltipProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="min-w-0 flex-1 px-8 py-8">
              <div className="mx-auto w-full max-w-6xl">{children}</div>
            </main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
