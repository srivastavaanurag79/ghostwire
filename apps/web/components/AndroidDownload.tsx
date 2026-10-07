"use client";

/**
 * Android APK download link.
 *
 * Defaults to the **latest GitHub Release** asset named `ghostwire.apk`, so the
 * binary lives in Releases (not in git history) and the link is always current.
 * Override with NEXT_PUBLIC_ANDROID_APK_URL, or set it to "none" to hide.
 */
const GITHUB_APK_URL =
  "https://github.com/srivastavaanurag79/ghostwire/releases/latest/download/ghostwire.apk";

export function AndroidDownload({ className = "" }: { className?: string }) {
  const configured = process.env.NEXT_PUBLIC_ANDROID_APK_URL;
  if (configured === "none") return null;
  const url = configured && configured !== "" ? configured : GITHUB_APK_URL;

  return (
    <a
      href={url}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 py-4 text-base font-semibold text-white transition hover:bg-white/10 ${className}`}
    >
      <span aria-hidden>🤖</span>
      Download Android app
    </a>
  );
}
