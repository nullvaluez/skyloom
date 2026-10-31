/** Keep the first response useful while the much larger flight bundle loads.
 * No flight/Three imports: this must be available before that bundle is. */
export function LaunchScreen() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#04060f] text-[#eef5ff]" role="status" aria-live="polite" data-testid="launch-screen">
      <div className="text-3xl font-bold uppercase tracking-[0.28em]">Skyloom</div>
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#8fa0bf]/30 border-t-[#eef5ff] motion-reduce:animate-none" aria-hidden="true" />
      <p className="text-sm text-[#8fa0bf]">Preparing your flight…</p>
    </div>
  );
}
