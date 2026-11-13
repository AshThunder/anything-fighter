import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const display = localFont({ src: "./fonts/SpaceGrotesk.woff2", variable: "--font-sg", weight: "300 700" });
const body = localFont({ src: "./fonts/Inter.woff2", variable: "--font-inter", weight: "100 900" });

export const metadata: Metadata = {
  title: "Anything Fighter · Aholo Lux3D",
  description: "Snap anything. Fight everything. One photo → rigged 3D fighter via Aholo Lux3D.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased dark`}>
      <body className="min-h-full bg-[#0d0b09] font-sans text-orange-50">{children}</body>
    </html>
  );
}
