import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "科研物料管理",
  description: "实验室物料入库、效期、领用和库存台账管理。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
