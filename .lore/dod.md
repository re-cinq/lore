# Definition of Done

> A cache that cannot be written or holds a bad entry should cost a cache miss, never the read.

**Strategy: `direct`** — The proxy-cache module exports the direct entry points `withReadCache` and `isCacheEnabled` which can be tested against the disk.

## Done when these pass

- [x] **A read whose cache write fails still returns the proxied answer** — A read whose cache write fails still returns the proxied answer.
  `libs/server-core/src/outbound/proxy-cache-faults.acceptance.test.ts`
- [x] **A malformed or truncated cache entry is a miss and is replaced on the next read** — A malformed or truncated cache entry is a miss and is replaced on the next read.
  `libs/server-core/src/outbound/proxy-cache-faults.acceptance.test.ts`
- [x] **A cache path that is a symlink is not written through** — A cache path that is a symlink is not written through.
  `libs/server-core/src/outbound/proxy-cache-faults.acceptance.test.ts`
- [x] **A malformed config.json falls back to the defaults** — A malformed config.json falls back to the defaults.
  `libs/server-core/src/outbound/proxy-cache-faults.acceptance.test.ts`

## Facets

- [x] Catch exceptions in withReadCache's call to storeWhenCacheable
- [x] Validate CacheEntry shape before returning from readEntry
- [x] Throw or ignore if writeJson target is a symlink
- [x] Validate CacheConfig shape before returning from loadConfig

## Out of scope

- Fixing other potential IO bugs unrelated to the proxy cache.
