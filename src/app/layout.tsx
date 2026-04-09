import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pollux",
  description: "Personal AI Assistant",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg-primary text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
