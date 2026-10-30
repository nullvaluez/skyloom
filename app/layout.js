import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// SHIP PASS RL-5: share metadata. Absolute URLs come from NEXT_PUBLIC_SITE_URL
// (the owner sets the domain). With it unset, Next falls back at BUILD time:
// the Vercel production URL on Vercel, otherwise http://localhost:3000 (the
// page is prerendered), so a self-hosted build must set it. Measured in the
// venue: an unset build bakes localhost:3000 into og:image. The legacy
// shadowadsb.app domain is gone, and the copy leads
// with the real Earth (PLAYER_SURFACE: one look). The card is an in-game
// capture (public/og/README.md).
const SITE_URL = /^https?:\/\//.test(process.env.NEXT_PUBLIC_SITE_URL || "") ? process.env.NEXT_PUBLIC_SITE_URL : null;
const SHARE_DESCRIPTION = "Fly the real Earth: satellite imagery and terrain of the whole planet, live air traffic, airports to watch, guided journeys and free flight over famous places.";
const SHARE_IMAGE = { url: "/og/skyloom.jpg", width: 1200, height: 630, alt: "A Skyloom flight over the Grand Canyon, from the game's own renderer" };

export const metadata = {
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
  title: "Skyloom - Fly the living Earth",
  description: "Fly the real Earth: satellite imagery and terrain of the whole planet, live air traffic from real flights, airports to watch, guided journeys, takeoffs and landings, free flight over famous places, and a logbook of every plane you spot.",
  keywords: ["Skyloom", "flying game", "flight game", "flight simulator", "satellite", "ADS-B", "aviation", "3D", "exploration"],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Skyloom",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    title: "Skyloom - Fly the living Earth",
    description: SHARE_DESCRIPTION,
    siteName: "Skyloom",
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Skyloom - Fly the living Earth",
    description: SHARE_DESCRIPTION,
    images: [SHARE_IMAGE.url],
  },
  icons: {
    icon: [
      { url: "/logo.webp" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/logo.webp" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
  },
};

export const viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* PWA meta tags */}
        <meta name="application-name" content="Skyloom" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Skyloom" />
        <link rel="apple-touch-icon" href="/logo.webp" />
        
        {/* Splash screens for iOS */}
        <link
          rel="apple-touch-startup-image"
          href="/splash/apple-splash-2048-2732.png"
          media="(device-width: 1024px) and (device-height: 1366px)"
        />
        <link
          rel="apple-touch-startup-image"
          href="/splash/apple-splash-1170-2532.png"
          media="(device-width: 390px) and (device-height: 844px)"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
