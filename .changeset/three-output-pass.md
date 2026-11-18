---
'@ascii-fx/three': minor
'@ascii-fx/react-three': minor
---

**Changes what you see:** `AsciiPass` matches the scene as the canvas would have shown it. It rendered into a plain render target, which skips three's output pass: the renderer's `toneMapping` was dropped (React Three Fiber turns ACES on by default, so mounting `<AsciiEffect>` changed a scene's colours), there was no antialiasing, and linear values sat in an 8-bit texture before being sRGB-encoded. The target is now the renderer's output target, so tone mapping, `outputColorSpace` and MSAA all apply. Colours under the pass will shift for any scene that uses tone mapping; that is the fix.

Also:

- `pass.init()` initializes the renderer if nothing has yet, so the README's quickstart works as written. It was missing the `init()` call altogether.
- The render target follows the renderer's drawing buffer, so `renderer.setSize()` is all a resize takes. `width`/`height` or `pass.setSize()` still pin it. `<AsciiEffect>` relies on this now, which also picks up a change of device pixel ratio that it used to miss.
- An interaction with `source: 'motion'` gets its motion field under the pass, as it does in the renderer; it was silently inert.
- README: the `AsciiGlyphs` example used an API that does not exist (`scene.add(glyphs)`, `glyphs.setSource()`); it is `glyphs.mesh` and `glyphs.updateFromFrame(frame)`. The React Three Fiber example's `gl` factory took the canvas where R3F 9 passes its renderer props, and never initialized the renderer.
