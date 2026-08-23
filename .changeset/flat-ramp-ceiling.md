---
"@ascii-fx/core": minor
"@ascii-fx/gpu": minor
---

The mono/foreground flat path now spans the charset's own tonal range instead of collapsing its top two thirds onto one glyph.

`structural-v1` §6 mapped a flat cell's mean luma onto glyph ink coverage as `luma · 257`, i.e. onto the full 0..65535 a *completely* inked cell would score. No ASCII glyph is completely inked: `@` in Geist Mono covers 16906/65535, about 26%. Every flat cell brighter than that targeted a coverage no glyph could reach and clamped to the densest one. A linear gradient rendered as six glyphs of ramp followed by eighteen cells of solid `@`.

The target is now normalised into the profile's own range — `rdiv(luma · covMax, 255)`, where `covMax` is the densest glyph the profile actually has. Both the CPU matcher and the WGSL matcher changed together and remain bit-identical; the conformance suite passes unchanged.

**This changes output** for `color: 'mono'` and `color: 'foreground'` on flat cells, which is why it is a minor rather than a patch. `color: 'full'` is unaffected (flat cells there emit the blank glyph with fg = bg = mean), and structural cells are unaffected in every mode. Charsets whose densest glyph is near-fully-inked — `ascii-blocks`, which has `█` — barely move, because for them the old ceiling was already about right. That is also why this survived to release: the charset that exposes it worst is the default one.

`ALGORITHM.md` §6 is updated, including why the previous rationale for leaving it unnormalised does not hold: it argued the structural rerank saturates at the densest glyph in the same way, but structural cells plateau at whatever glyph matches their *shape* — measured at `w` (11656) for a high-contrast cell, well below the `@` (16906) the old flat target reached. The two paths were never consistent.
