"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders any string as a QR code onto a canvas.
 *
 * The canvas is drawn at a higher backing-store resolution than its CSS size
 * (accounting for device pixel ratio) so the modules stay crisp when a phone
 * camera reads the screen. A generous quiet zone is included because scanners
 * need it to lock on.
 */
export function QRCanvas({ value, size = 300 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const backing = Math.round(size * Math.max(2, Math.min(dpr, 3)));
    QRCode.toCanvas(canvas, value, {
      width: backing,
      margin: 3,
      errorCorrectionLevel: "L",
      color: { dark: "#0e1621", light: "#ffffff" },
    })
      .then(() => {
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
      })
      .catch((e) => setError(String(e)));
  }, [value, size]);

  if (error) return <p className="text-sm text-tg-red">{error}</p>;
  return (
    <div className="rounded-2xl bg-white p-3 shadow-lg" style={{ width: size + 24 }}>
      <canvas ref={ref} className="block" style={{ width: size, height: size }} />
    </div>
  );
}
