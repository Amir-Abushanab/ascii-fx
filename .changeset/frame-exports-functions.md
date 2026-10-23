---
'@ascii-fx/core': minor
---

**Breaking:** the frame exports are now standalone functions instead of `AsciiFrame` methods.

```diff
- frame.toText()
- frame.toAnsi()
- frame.toHTML()
+ import { frameToText, frameToAnsi, frameToHTML, frameToSVG } from '@ascii-fx/core'
+ frameToText(frame)
+ frameToAnsi(frame)
+ frameToHTML(frame)
+ frameToSVG(frame)
```

A bundler drops an unused export but never an unused class method, since it cannot prove nothing reaches the method through the prototype. As methods, every format shipped in every bundle that matched anything, because `matchFrame` returns an `AsciiFrame`. As functions, a bundle carries only the formats it imports: `matchFrame` plus `frameToText` is 5.8 KB gzipped, down from 6.2 KB in 0.8.0, and the `@ascii-fx/gpu` renderer, which formats no text at all, sheds about 1.2 KB. `getCell` stays a method.
