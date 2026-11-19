---
'@ascii-fx/core': minor
---

**Breaking:** `decodeProfile` rejects a profile whose `fontFamily` or `fontWeight` metadata is the wrong type. Such a file used to load, and then made `frameToSVG` throw on a non-string `fontFamily`. Nothing `@ascii-fx/compiler` or `createAsciiProfile` writes is affected; a profile produced by other tooling may be.

`frameToSVG` also falls back to `monospace` for a profile built in memory with a non-string `fontFamily`, rather than throwing.
