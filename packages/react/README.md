# @ascii-fx/react

React components and hooks. SSR-safe: the server renders a layout-stable wrapper with the accessible original media; the client hydrates, initializes the renderer, and swaps without layout shift or flash. Files ship with the `'use client'` directive for RSC/Next App Router.

```tsx
import { AsciiImage } from '@ascii-fx/react'

// zero-config: runtime 'monospace' profile
<AsciiImage src="/cat.jpg" alt="Cat" />

// production: precompiled profile + interaction
import profileRef from 'virtual:ascii-profile/default'

<AsciiImage
  src="/hero.jpg"
  alt="Portrait"
  profile={profileRef}
  columns={160}
  color="full"
  interaction={{ type: 'reveal', radius: 0.18, feather: 0.08 }}
/>

<AsciiVideo src="/clip.mp4" profile={profileRef} />
<AsciiCanvas source={myCanvas} renderMode="continuous" profile={profileRef} />
```

- `alt` is required on `AsciiImage` (`alt=""` for decorative). The fallback element stays in the accessibility tree; the canvas is `aria-hidden` (spec §32).
- `prefers-reduced-motion` disables interactions while keeping the static ASCII.
- Ordinary prop changes map to `setOptions` — the renderer is recreated only when the profile or backend changes (spec §31). Pointer moves are forwarded automatically.
- Ref handle: `{ renderer, render(), capture(): Promise<AsciiFrame>, getSupport() }`.

Hooks: `useAscii(canvasRef, options)`, `useAsciiProfile(source?)`, `useAsciiSupport()`, `usePrefersReducedMotion()`.
