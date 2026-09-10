/** @type {import('next').NextConfig} */
const nextConfig = {
  // Isolate review builds from a running local server's generated files.
  distDir: process.env.FLY_BUILD_DIR || '.next',
  // Keep the normal Turbopack path free of custom webpack configuration.
  ...(process.env.FLY_BUILD_DIR ? {
    webpack(config) {
      // Node 25's incremental webpack WASM hash path fails on this workstation.
      config.cache = false;
      return config;
    },
  } : {}),
  reactStrictMode: true,

  // Required for the three.js ecosystem (Fly mode). Do NOT enable
  // experimental.cacheComponents — it breaks R3F canvas re-init on
  // back/forward navigation (pmndrs/react-three-fiber#3595).
  transpilePackages: ['three', 'three-stdlib', 'three-tile'],

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.planespotters.net',
        pathname: '/photos/**',
      },
      {
        protocol: 'https',
        hostname: '*.planespotters.net',
        pathname: '/**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
  },

  experimental: {
    optimizePackageImports: ['lucide-react'],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(self)',
          },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=3, stale-while-revalidate=10',
          },
        ],
      },
      {
        source: '/models/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/hdri/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
