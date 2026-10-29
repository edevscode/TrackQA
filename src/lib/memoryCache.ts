type CacheEntry<T> = {
  data: T
  timestamp: number
  ttl: number
}

const DEFAULT_TTL_MS = 60 * 1000 // 60 seconds default cache TTL

export type CacheInvalidationListener = (pattern?: string | RegExp) => void

export class MemoryCache {
  private identity: string | null = null
  private generation = 0
  get scopeVersion() { return this.generation }

  setIdentity(userId: string | null): void {
    if (this.identity === userId) return
    this.identity = userId
    this.generation++
    this.cache.clear()
  }

  private cache = new Map<string, CacheEntry<unknown>>()
  private listeners = new Set<CacheInvalidationListener>()

  get<T>(key: string): T | null {
    if (!this.identity) return null
    const entry = this.cache.get(key) as CacheEntry<T> | undefined
    if (!entry) return null

    const isExpired = Date.now() - entry.timestamp > entry.ttl
    if (isExpired) {
      this.cache.delete(key)
      return null
    }

    return entry.data
  }

  set<T>(key: string, data: T, ttl: number = DEFAULT_TTL_MS, scopeVersion = this.generation): void {
    if (!this.identity || scopeVersion !== this.generation) return
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    })
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  subscribe(listener: CacheInvalidationListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  invalidate(patternOrPrefix?: string | RegExp): void {
    if (!patternOrPrefix) {
      this.cache.clear()
    } else {
      const regex =
        patternOrPrefix instanceof RegExp
          ? patternOrPrefix
          : new RegExp(`^${patternOrPrefix}`)

      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          this.cache.delete(key)
        }
      }
    }

    // Notify all active listeners
    for (const listener of this.listeners) {
      try {
        listener(patternOrPrefix)
      } catch (err) {
        console.error('Cache listener error:', err)
      }
    }
  }
}
