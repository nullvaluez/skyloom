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

export const metadata = {
  title: "Skyloom - Fly the living Earth",
  description: "Fly the living Earth. Real satellite terrain or a neon world built from real map data, live ADS-B air traffic, takeoffs and landings, free flight over famous places, and a logbook of every plane you spot.",
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
    url: "https://shadowadsb.app",
    title: "Skyloom - Fly the living Earth",
    description: "Fly the living Earth: real satellite terrain, live ADS-B air traffic, takeoffs and landings, and free flight over famous places.",
    siteName: "Skyloom",
  },
  twitter: {
    card: "summary_large_image",
    title: "Skyloom - Fly the living Earth",
    description: "Fly the living Earth: real satellite terrain, live ADS-B air traffic, takeoffs and landings, and free flight over famous places.",
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
