import { avatarHue, initials, cx } from "@/lib/utils";

export function Avatar({
  name,
  pubkey,
  size = 40,
  className,
}: {
  name: string;
  pubkey?: Uint8Array;
  size?: number;
  className?: string;
}) {
  const hue = pubkey && pubkey.length ? avatarHue(pubkey) : 210;
  return (
    <div
      className={cx("flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${hue} 65% 52%), hsl(${(hue + 40) % 360} 62% 44%))`,
      }}
    >
      {initials(name)}
    </div>
  );
}
