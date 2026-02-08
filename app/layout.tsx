import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const sublima = localFont({
  src: "./fonts/Sublima-ExtraBoldItalic.otf",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Barber Web",
  description: "Admin",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${sublima.className} antialiased bg-white text-zinc-900`}>
        {children}
      </body>
    </html>
  );
}
