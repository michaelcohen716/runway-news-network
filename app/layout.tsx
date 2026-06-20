import type { Metadata } from "next";
import { Archivo_Narrow, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo_Narrow({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Runway News Network",
  description: "Paste a news link. Get a 30-second AI broadcast segment.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${inter.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        {/* Preconnect so the icon font resolves fast; display=block avoids the
            ligature flash (raw "broadcast_on_home" text) before it loads. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Icon font: display=block is intentional — it hides the raw ligature
            text (e.g. "broadcast_on_home") until the glyphs load. */}
        {/* eslint-disable-next-line @next/next/google-font-display, @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
        />
      </head>
      <body className="min-h-full bg-background font-body-md text-on-background selection:bg-primary-container selection:text-on-primary-container">
        {children}
      </body>
    </html>
  );
}
