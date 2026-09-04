---
"@ascii-fx/core": patch
---

Document authoring a source FOR the grid in the skill.

The skill covered the renderer thoroughly and said nothing about what to feed it, which is where a
correct drawing most often arrives as an empty panel. One cell samples `sourceWidth / columns`
pixels across and fits a single colour to the block, so a feature narrower than a cell renders as
its share of that average rather than as a thin thing: a 3px line in a 6px cell fills 31%, and
`#66779c` at 31% composites to the panel's own colour. Raising the colour cannot fix that — at 31%
coverage it would need a luma above 255 — so the section is about coverage, with beaded paths as
the worked example.

Three gotchas alongside it: `foreground` is `mono` only and is silently ignored in
`color: 'foreground'` (where colour is fitted per cell from the source); `alpha: 'mask'` gates on
opacity rather than colour, so faintness belongs in the colour and gradients over an opaque fill
are fine; and when output is sparse, dump the source canvas before touching the renderer, because
"drew it wrong" and "drew it too small for the grid" look identical from the output side.
