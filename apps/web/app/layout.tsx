import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaManager } from "@/components/PwaManager";

export const metadata: Metadata = {
  title: "GhostWire",
  description:
    "Serverless, ephemeral, encrypted P2P mesh chat that works offline. No servers, no tracking, no trace.",
  applicationName: "GhostWire",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GhostWire",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0e1621",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        {children}
        <PwaManager />
      </body>
    </html>
  );
}
