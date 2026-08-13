/** A tiny bounded TTL cache, used to keep repeated lookups within one CLI
 * invocation (repo metadata, PR head SHAs) from turning into N identical
 * round trips. Process-local and deliberately not persisted: staleness
 * across runs would be far more confusing than a second request. */

export interface CacheOptions {
  /** Entries live this long. */
  readonly ttlMillis: number;
  /** Hard cap on entries; the oldest insertion is dropped past this. */
  readonly maxEntries: number;
}

interface Entry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

export class TtlCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();

  constructor(private readonly options: CacheOptions) {}

  get(key: K, now = Date.now()): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;

    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh recency: Map preserves insertion order, so re-inserting moves
    // this key to the back of the eviction queue.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, now = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + this.options.ttlMillis });

    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Reads through to `load` on a miss. Note this does not de-duplicate
   * concurrent loads for the same key — the CLI issues these sequentially,
   * so a request-coalescing map would be dead weight here. */
  async getOrLoad(key: K, load: (key: K) => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;

    const value = await load(key);
    this.set(key, value);
    return value;
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Live entry count, excluding anything already past its TTL. */
  size(now = Date.now()): number {
    let live = 0;
    for (const entry of this.entries.values()) {
      if (entry.expiresAt > now) live += 1;
    }
    return live;
  }
}
