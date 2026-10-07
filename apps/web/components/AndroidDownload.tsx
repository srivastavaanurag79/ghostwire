"use client";

/**
 * Android APK download link. Defaults to `/downloads/ghostwire.apk` (shipped in
 * the web app's public folder); override with NEXT_PUBLIC_ANDROID_APK_URL to
 * point at a hosted file or a GitHub Release asset instead.
 */
export function AndroidDownload({ className = "" }: { className?: string }) {
  const hidden = process.env.NEXT_PUBLIC_ANDROID_APK_URL === "none";
  if (hidden) return null;
  const url = process.env.NEXT_PUBLIC_ANDROID_APK_URL || "/downloads/ghostwire.apk";

  return (
    <a
      href={url}
      download="ghostwire.apk"
      className={`inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 py-4 text-base font-semibold text-white transition hover:bg-white/10 ${className}`}
    >
      <span aria-hidden>🤖</span>
      Download Android app
    </a>
  );
}
