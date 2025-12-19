export const siteConfig = {
  name: "SkyTracker",
  description: "Real-time aircraft tracking with interactive maps",
  url: "https://skytracker.app",
  author: "SkyTracker",
  links: {
    github: "https://github.com/skytracker",
  },
};

export const metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    "aircraft tracking",
    "flight tracker",
    "ADS-B",
    "aviation",
    "real-time",
    "flights",
    "planes",
  ],
  authors: [
    {
      name: siteConfig.author,
      url: siteConfig.url,
    },
  ],
  creator: siteConfig.author,
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon-16x16.png",
    apple: "/apple-touch-icon.png",
  },
};
