'use client';

import dynamic from 'next/dynamic';

// Round 9 (fly-only pivot): the game IS the app. FlyMode mounts directly —
// no ui-store gate, no header/sidebar chrome. The dynamic() fallback is a
// plain ink void: FlyMode's own BootScreen takes over the moment the three.js
// bundle lands (window.__flyBoot is the boot progress contract).
const FlyMode = dynamic(
  () => import('@/components/fly/FlyMode').then((mod) => mod.FlyMode),
  {
    ssr: false,
    loading: () => <div className="fixed inset-0 bg-[#04060f]" />,
  }
);

export default function Home() {
  return (
    // "Exit" now means a fresh boot — there is no 2D tracker to fall back to.
    <FlyMode onClose={() => window.location.reload()} />
  );
}
