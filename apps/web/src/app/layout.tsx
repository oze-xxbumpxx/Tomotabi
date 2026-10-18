import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Tomotabi",
  description: "ふたりの旅行のしおり・記録・精算をひとつに。",
};

// スマホで、入力欄を押したときの自動の拡大と、指での拡大縮小を止める。
// 入力欄の文字（15px）が16pxより小さいと、iPhoneのSafariは押したときに画面を拡大し、
// そのまま戻らない（2026-10-18 結合検証環境でユーザーが指摘）。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
