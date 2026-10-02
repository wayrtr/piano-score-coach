import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Piano } from "lucide-react";

import { AppLifecycleHeartbeat } from "@/components/app-lifecycle-heartbeat";
import { ThemeToggle } from "@/components/theme-toggle";

import "./globals.css";
import "./workspace.css";
import "./practice.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: "看谱找琴键",
  description: "点击五线谱音符，查看对应的钢琴琴键与吉他位置。",
};

// Runs before first paint so the resolved theme is set on <html> and there is
// no light flash before React hydrates. Kept tiny and dependency-free.
const themeInitScript = `(function(){try{var k="piano-score-coach:theme";var p=localStorage.getItem(k);if(p!=="light"&&p!=="dark"&&p!=="system")p="system";var dark=p==="dark"||(p==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=dark?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <a className="skip-link" href="#main-content">跳到主要内容</a>
        <AppLifecycleHeartbeat />
        <header className="app-header">
          <Link className="app-brand" href="/" aria-label="看谱找琴键 · 我的谱子">
            <span className="app-brand-mark"><Piano size={22} aria-hidden="true" /></span>
            <span className="app-brand-copy"><strong>看谱找琴键</strong><span>五线谱 → 钢琴 / 吉他</span></span>
          </Link>
          <div className="app-header-tools">
            <span className="local-badge"><span />本地乐谱</span>
            <ThemeToggle />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
