---
"@ascii-fx/gpu": patch
---

`clearColor` with alpha below 1 now presents transparent in every colour mode, not only `color: 'foreground'`.

The canvas was configured `alphaMode: color === 'foreground' ? 'premultiplied' : 'opaque'`, so in `mono`, `full`, and `glyph` the compositor was told the canvas is opaque and discarded the alpha channel on present. A documented option was silently ignored in three of four modes, and the letterbox — the one region `clearColor` governs in those modes, since every cell there carries an opaque background by construction — painted black instead of letting the page through.

The configuration now keys on whether the output can be transparent rather than on the colour mode: `foreground`, or an explicit `clearColor` with alpha < 1. It deliberately does *not* key on `alpha: 'mask'`, which is the default and would make every canvas premultiplied, giving up the opaque fast path that lets the browser skip blending the canvas against the page for the common fully-opaque case.

`setOptions` reconfigures whenever that answer changes, rather than only on the `foreground` boundary.
