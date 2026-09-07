"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { LogoutButton } from "@/components/logout-button";
import {
  LayoutDashboard,
  DatabaseZap,
  Settings,
  Waypoints,
  Globe,
  Link2,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Thị trường",
    items: [{ href: "/markets", label: "Thị trường", icon: LayoutDashboard }],
  },
  {
    label: "Nội dung",
    items: [{ href: "/collector", label: "Thu thập dữ liệu", icon: DatabaseZap }],
  },
  {
    label: "Vận hành",
    items: [
      { href: "/domains", label: "Domain", icon: Link2 },
      { href: "/publisher", label: "Publisher", icon: Globe },
      { href: "/settings", label: "Cài đặt", icon: Settings },
    ],
  },
];

/** showLogout comes from the server (app/layout.tsx) because this is a client
 * component and cannot read NODE_ENV meaningfully — the value it would see is
 * the build-time one, not the running server's. */
export function Sidebar({ showLogout = false }: { showLogout?: boolean }) {
  const pathname = usePathname();

  // Hidden on the login page. The sidebar is a map of the application — every
  // module, named — and the root layout would otherwise draw it for anyone who
  // loads the page, logged in or not. None of the links work without a
  // session, so this is not a way in; it is a free description of what is
  // behind the door, handed to whoever knocks.
  //
  // Done here rather than with a nested layout because Next nests INSIDE the
  // root layout: app/login/layout.tsx cannot remove what the root already drew.
  // Placed AFTER the hook, never before — an early return above a hook makes
  // that hook conditional, which is the bug eslint caught when this was first
  // written the other way round.
  if (pathname === "/login") return null;

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-5 py-6">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Waypoints className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">Bảng điều khiển pSEO</p>
          <p className="text-xs text-sidebar-foreground/60">Pipeline nội bộ</p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-2 text-xs font-semibold tracking-wider text-sidebar-foreground/45 uppercase">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-2 border-t border-sidebar-border px-5 py-4">
        {showLogout ? <LogoutButton /> : null}
        <p className="text-xs text-sidebar-foreground/45">
          Công cụ nội bộ — không phải trang công khai.
        </p>
      </div>
    </aside>
  );
}
