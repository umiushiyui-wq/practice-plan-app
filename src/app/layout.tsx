import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import "./admin-plan.css";

export const metadata: Metadata = {
  title: "2027OB\u6f14\u594f\u4f1a\u51fa\u6b20",
  description: "2027OB\u6f14\u594f\u4f1a\u306e\u51fa\u6b20\u7ba1\u7406",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link className="brand-link" href="/">
              2027 OB演奏会
            </Link>
            <nav className="topnav" aria-label="主要ページ">
              <Link href="/admin">管理</Link>
              <Link href="/player">奏者</Link>
              <Link href="/sheet">練習表</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
