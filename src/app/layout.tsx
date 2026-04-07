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
            <Link href="/">2027OB演奏会出欠</Link>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
