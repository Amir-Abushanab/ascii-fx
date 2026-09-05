---
"@ascii-fx/gpu": minor
"@ascii-fx/react": minor
---

Device tilt as a pointer source. Every `interaction` type is driven by the pointer, so an effect
tuned on a desktop does nothing on a phone; `tilt` fills that in from the orientation sensor.

`@ascii-fx/gpu` exports `TiltSource` (readings normalized to 0..1 canvas coordinates the way a ball
would roll on the screen, rotated by the screen angle so "right" stays right in landscape, and
centred on whatever pose the reader was already holding) and `forwardTiltToPointer`, which eases the
renderer's pointer toward each new pose on a frame loop that parks itself once it arrives.

`@ascii-fx/react` adds a `tilt` prop (`true`, or `{ range, smoothing, invertX, invertY }`) to
`<AsciiImage>`, `<AsciiVideo>` and `<AsciiCanvas>`, plus `enableTilt()` / `tiltStatus()` /
`recenterTilt()` on the handle.

iOS gets no tilt, on purpose: Safari gates the sensor behind a modal permission dialog and nothing
here opens one, so the component looks exactly as it does without `tilt`. A decorative effect is not
worth interrupting a reader for, so tilt is an enhancement some phones simply don't get.
`enableTilt()` is the explicit opt-in for a page where tilt is the point. Reduced motion suppresses
tilt like it suppresses autoplay.

The sensor ships as its own subpath, `@ascii-fx/gpu/tilt`, and the components fetch it with a
dynamic import only when a `tilt` prop asks for it — so an app that renders `<AsciiImage>` without
tilt carries none of those bytes.
