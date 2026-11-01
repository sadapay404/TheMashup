import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DEFAULT_THEME, themeCss } from "@/lib/themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "TheMashup",
  description: "A local-first music player: search, lyrics, playlists and offline downloads.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%239B80FF'/%3E%3Cstop offset='1' stop-color='%236C9BFF'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='18' fill='url(%23g)'/%3E%3Ctext x='32' y='42' font-family='Arial' font-weight='900' font-size='36' text-anchor='middle' fill='%230B0B12'%3Em.%3C/text%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = { themeColor: "#0A0A0F", width: "device-width", initialScale: 1 };

const initScript = `try{var s=JSON.parse(localStorage.getItem("mashup.settings")||"{}");document.documentElement.dataset.theme=s.theme||"${DEFAULT_THEME}"}catch(e){document.documentElement.dataset.theme="${DEFAULT_THEME}"}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
