import type { Metadata } from "next";
import "./globals.css";

/**
 * Root layout — wraps every page. In Next.js App Router this is required.
 * We keep it minimal: just set the document language, title, and import the
 * global stylesheet.
 */
export const metadata: Metadata = {
  title: "Gmail Intelligence Platform",
  description: "Connect your Gmail account (Stage 1: auth only).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
