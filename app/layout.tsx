import type { Metadata } from "next";
import "./globals.css";
import "./responsive.css";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: {
    default: "定位台 · 问题定位跟踪系统",
    template: "%s · 定位台",
  },
  description: "面向硬件测试现场的责任组制问题定位跟踪系统",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}