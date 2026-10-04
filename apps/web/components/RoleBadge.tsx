import type { Role } from "@ghostwire/protocol";
import { ROLE_META, cx } from "@/lib/utils";

export function RoleBadge({ role, compact = false }: { role: Role; compact?: boolean }) {
  const meta = ROLE_META[role];
  if (compact) {
    return <span className={cx("inline-block h-2 w-2 rounded-full", meta.dot)} title={meta.label} />;
  }
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
        meta.text,
        meta.ring,
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}
