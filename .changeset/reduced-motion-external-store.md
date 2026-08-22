---
"@ascii-fx/react": patch
---

React: reduced-motion reads correctly on the first client render, and `<AsciiVideo>` reliably pauses on unmount.

`usePrefersReducedMotion` moves from state-plus-effect to `useSyncExternalStore`. It used to render `false`, then set the real value in an effect — so a user who asks for reduced motion got one animated frame and a re-render before the preference took hold. The store form reads the media query on the first client render and declares an explicit `false` server snapshot, so hydration still matches.

The continuous-playback cleanup captured the media element at effect setup instead of reading `mediaRef.current` at teardown, where React may already have detached the ref and the `pause()` would silently no-op.
