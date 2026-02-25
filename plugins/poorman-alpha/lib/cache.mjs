/**
 * cache.js — LRU expression result cache for poorman-alpha.
 * Enhancement E-05: Avoids redundant computation for deterministic expressions.
 */

class LRUCache {
  /**
   * @param {number} maxSize - Maximum number of entries
   */
  constructor(maxSize = 256) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get a cached result.
   * @param {string} key
   * @returns {any|undefined}
   */
  get(key) {
    if (!this.cache.has(key)) {
      this.misses++;
      return undefined;
    }
    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    this.hits++;
    return value;
  }

  /**
   * Set a cached result.
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  /**
   * Clear the cache.
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics.
   */
  stats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? (this.hits / (this.hits + this.misses) * 100).toFixed(1) + '%'
        : 'N/A'
    };
  }
}

export { LRUCache };
