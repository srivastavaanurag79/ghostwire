"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

/** Renders any string as a QR code onto a canvas. */
export function QRCanvas({ value, size = 260 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "L",
      color: { dark: "#0e1621", light: "#ffffff" },
    }).catch((e) => setError(String(e)));
  }, [value, size]);

  if (error) return <p className="text-sm text-tg-red">{error}</p>;
  return (
    <div className="rounded-2xl bg-white p-3 shadow-lg" style={{ width: size + 24 }}>
      <canvas ref={ref} width={size} height={size} className="block" />
    </div>
  );
}
