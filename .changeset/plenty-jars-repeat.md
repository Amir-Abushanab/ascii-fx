---
"@ascii-fx/react": minor
---

Add `draw` to `<AsciiImage>`: paint the source yourself.

The component set the `<img>` as the source and rendered once, with nothing in between, so there
was no seam for a pixel effect at all — wanting one changed pixel meant dropping to
`<AsciiCanvas>` and hand-rolling the image load, the buffer and the loop. That is the wrong bar for
a contrast curve, which a soft photograph needs before the matcher will separate anything in it.

`draw(ctx, { image, width, height }, timeMs)` gets a 2D context over a buffer the image's natural
size, so `fit`, `columns` and the rest behave exactly as they do without it. Nothing is drawn into
it for you — paint the image first if you want it — which is what lets a `draw` replace the picture
rather than only decorate it.

This is deliberately not a renderer option. The matcher is exact about the pixels it is handed and
owns nothing upstream of them, and a `noise:`-style option would put a PRNG inside that claim and
owe an identical seeded hash to the WGSL, the GLSL and the TypeScript matcher. Effects belong on
the source; what was missing was a way to say so from the zero-config path.

`animate` re-runs `draw` on the component's own loop, throttled to `fps` (default 12) rather than
`renderer.start()`'s display rate — each frame is a full re-match, and glyph churn above ~15fps
stops reading as movement in the picture and starts reading as noise in the text. It stops
off-screen, on a hidden tab and under `prefers-reduced-motion`, in each case leaving the last
painted frame up: the first paint happens before any of those gates, so a still is never withheld,
only its movement. Default false, so an image stays matched-once until you ask otherwise.

The visibility predicate `<AsciiVideo>` already used is now shared with this loop rather than
copied, so the two cannot disagree about what "should be running" means.
