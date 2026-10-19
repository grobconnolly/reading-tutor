import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Lexend } from "next/font/google";
import "./globals.css";

const lexend = Lexend({ subsets: ["latin"], variable: "--font-read", display: "swap" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  title: "Reading Coach",
  description: "Coach Juno listens while you read, helps with tricky words, and cheers you on.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EDF1F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1621" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lexend.variable} ${bricolage.variable}`}>
      <body>{children}</body>
    </html>
  );
}
