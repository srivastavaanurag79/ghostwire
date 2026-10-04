import { SEEN_CACHE_LIMIT } from "@ghostwire/protocol";

/**
 * Insertion-ordered set with a hard cap, used to drop duplicate message ids.
 * Cap is small (10k) and lives only in memory, so it is wiped with the session.
 */
export class SeenCache {
  private readonly set = new Set<string>();

  constructor(private readonly limit: number = SEEN_CACHE_LIMIT) {}

  has(id: string): boolean {
    return this.set.has(id);
  }

  /** Returns false when the id was already present. */
  add(id: string): boolean {
    if (this.set.has(id)) return false;
    this.set.add(id);
    if (this.set.size > this.limit) {
      const oldest = this.set.values().next().value;
      if (oldest !== undefined) this.set.delete(oldest);
    }
    return true;
  }

  get size(): number {
    return this.set.size;
  }

  clear(): void {
    this.set.clear();
  }
}
