---
'@ascii-fx/gpu': patch
---

Fixes for a renderer that is not in a plain animation loop, on both backends unless noted:

- **A paused or ended video keeps responding.** `start()` on a `<video>` runs on video-frame callbacks, which stop when the video does. Pointer moves and `setInteraction()` stood down for "the running loop" anyway, so a hover effect froze, and on WebGPU a resize left the canvas blank until playback resumed. They repaint now, as a composite of the frame already matched rather than a re-upload. On the CPU backend, `wave` and `displace` keep animating too.
- **`setOptions()` repaints.** It was the one setter that left the repaint to someone else, so a still changed only on the next pointer move or resize. `setOptions({ interaction })` is forwarded to `setInteraction()` instead of being dropped.
- **One bad frame no longer ends the loop.** A source that could not be read for a moment (a canvas at zero size) threw out of the loop, which then stopped while still marked as running, so `start()` could not revive it. The failure is logged once and the loop carries on.
- **A lost WebGL context does not throw.** The CPU backend's compositor fell through to a Canvas2D path its canvas cannot have. It now waits, and repaints when the browser restores the context.
- **`start()` and `stop()` during a device rebuild are honoured** (WebGPU). The loop came back as it was when the device was lost, whatever had been asked for since. A first frame that fails after a successful rebuild is no longer reported as an unrecovered device loss.
