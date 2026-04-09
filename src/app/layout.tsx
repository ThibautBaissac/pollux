import type { Metadata, Viewport } from "next";
import { RegisterSW } from "@/components/RegisterSW";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pollux",
  description: "Personal AI Assistant",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pollux",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f0f0f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-bg-primary text-text-primary antialiased">
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
