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
  title: "ShadowADSB - Real-time Aircraft Tracking",
  description: "Track aircraft in real-time with 3D visualization, AR spotting mode, and gamification. The ultimate flight tracking experience.",
  keywords: ["aircraft tracking", "flight tracker", "ADS-B", "aviation", "real-time", "flights", "AR", "3D map"],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ShadowADSB",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://shadowadsb.app",
    title: "ShadowADSB - Real-time Aircraft Tracking",
    description: "Track aircraft in real-time with 3D visualization, AR spotting mode, and gamification.",
    siteName: "ShadowADSB",
  },
  twitter: {
    card: "summary_large_image",
    title: "ShadowADSB - Real-time Aircraft Tracking",
    description: "Track aircraft in real-time with 3D visualization, AR spotting mode, and gamification.",
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
        <meta name="application-name" content="ShadowADSB" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ShadowADSB" />
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
