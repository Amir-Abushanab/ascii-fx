---
'@ascii-fx/core': minor
'@ascii-fx/compiler': minor
---

**Breaking:** `matchFrame` is structural-v1 only, and the `matcher` option is gone from `MatchOptions`.

```diff
- matchFrame(source, { profile, matcher: 'shape6' })
- matchFrame(source, { profile, matcher: 'ramp' })
- matchFrame(source, { profile, matcher: 'chromatic' })
+ matchFrameShape6(source, { profile })
+ matchFrameRamp(source, { profile })
+ matchFrameChromatic(source, { profile })
```

`matchFrame` used to switch on `matcher`, so every bundle that called it also carried shape6, ramp and chromatic-v1. Each matcher is now its own function: `matchFrame` alone drops from 5.5 KB to 3.4 KB gzipped, and an approximate matcher becomes an explicit import rather than a flag. `renderAscii` and the compiler's `buildFrame` are structural-only for the same reason.

Passing `matcher` to `matchFrame` from untyped code now throws, naming the function to call, rather than quietly running structural-v1. `jitter` is still refused by the matchers that have no rerank; that check moved into them. Renderers keep their `matcher: 'chromatic'` option.
