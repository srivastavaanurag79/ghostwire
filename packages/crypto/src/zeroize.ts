/**
 * Overwrite sensitive buffers in place. Used by panic-wipe and session-close
 * paths to reduce the window in which secrets linger in memory.
 *
 * `@noble` cannot guarantee the runtime won't have copied bytes elsewhere, but
 * best-effort zeroization is still worthwhile and costs nothing.
 */
export function zeroize(...buffers: Array<Uint8Array | undefined>): void {
  for (const buffer of buffers) {
    if (buffer) buffer.fill(0);
  }
}
