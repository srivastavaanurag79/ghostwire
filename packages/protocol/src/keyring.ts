import { AES_KEY_BYTES, deriveKey, zeroize } from "@ghostwire/crypto";
import { KEY_RETAIN_EPOCHS, KEY_ROTATION_INTERVAL_MS, MAX_EPOCH_FORWARD } from "./constants";

/**
 * One-way symmetric key ratchet for a session.
 *
 * Epoch 0 is the session key delivered by QR. Every rotation derives the next
 * epoch key with HKDF, so the chain only moves forward:
 *
 *     k[n] = HKDF(k[n-1], info = "ghostwire|ratchet|n")
 *
 * Rotating (and zeroizing) old epochs gives *forward secrecy*: someone who
 * later compromises the device and reads the current epoch key still cannot
 * compute the keys used for earlier messages. Because the chain is one-way,
 * past epochs cannot be re-derived; only a small window of recent epochs is
 * retained so out-of-order delivery still decrypts.
 *
 * Epochs advance on a shared wall-clock schedule counted from `sessionStart`,
 * so peers stay in lockstep without extra coordination messages.
 */
export class SessionKeyring {
  private readonly keys = new Map<number, Uint8Array>();
  private readonly sessionStart: number;
  private readonly intervalMs: number;
  private readonly retainEpochs: number;
  private highest = 0;

  constructor(
    rootKey: Uint8Array,
    sessionStart: number,
    intervalMs: number = KEY_ROTATION_INTERVAL_MS,
    retainEpochs: number = KEY_RETAIN_EPOCHS,
  ) {
    if (rootKey.length !== AES_KEY_BYTES) {
      throw new Error(`SessionKeyring: root key must be ${AES_KEY_BYTES} bytes`);
    }
    this.sessionStart = sessionStart;
    this.intervalMs = intervalMs;
    this.retainEpochs = retainEpochs;
    this.keys.set(0, rootKey.slice());
  }

  get currentEpoch(): number {
    return this.highest;
  }

  /** Epoch number implied by a wall-clock time. */
  epochForTime(now: number): number {
    return Math.max(0, Math.floor((now - this.sessionStart) / this.intervalMs));
  }

  /**
   * Advance the ratchet to the epoch implied by `now` and return that epoch.
   * Derivation is capped to avoid unbounded work if a clock is far ahead.
   */
  advanceTo(now: number): number {
    const target = this.epochForTime(now);
    return this.deriveTo(target);
  }

  /** Return the key for an epoch, deriving forward when it is in the future. */
  keyAt(epoch: number): Uint8Array | undefined {
    if (!Number.isInteger(epoch) || epoch < 0) return undefined;
    if (this.keys.has(epoch)) return this.keys.get(epoch);
    if (epoch < this.highest) return undefined; // pruned past epoch
    if (epoch - this.highest > MAX_EPOCH_FORWARD) return undefined;
    this.deriveTo(epoch);
    return this.keys.get(epoch);
  }

  /** Overwrite and drop all retained keys. */
  wipe(): void {
    for (const key of this.keys.values()) zeroize(key);
    this.keys.clear();
    this.highest = 0;
  }

  private deriveTo(target: number): number {
    if (target <= this.highest) return this.highest;
    let key = this.keys.get(this.highest);
    if (!key) return this.highest;
    for (let epoch = this.highest + 1; epoch <= target; epoch++) {
      key = deriveKey(key, undefined, `ghostwire|ratchet|${epoch}`, AES_KEY_BYTES);
      this.keys.set(epoch, key);
    }
    this.highest = target;
    this.prune();
    return this.highest;
  }

  private prune(): void {
    const cutoff = this.highest - this.retainEpochs;
    for (const epoch of [...this.keys.keys()]) {
      if (epoch < cutoff) {
        zeroize(this.keys.get(epoch));
        this.keys.delete(epoch);
      }
    }
  }
}
