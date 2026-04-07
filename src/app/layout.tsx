import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "吹奏楽 練習計画",
  description: "吹奏楽団向けの練習計画Webアプリ"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/dashboard">吹奏楽 練習計画</Link>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
