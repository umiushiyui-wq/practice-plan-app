import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "2027OB演奏会出欠",
  description: "2027OB演奏会の出欠管理"
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
              <Link href="/player">奏者</Link>
              <Link href="/admin">管理</Link>
              <Link href="/availability">可否一覧</Link>
              <Link href="/sheet">表</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
