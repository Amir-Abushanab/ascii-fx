---
'@ascii-fx/gpu': minor
'@ascii-fx/react': minor
'@ascii-fx/react-three': minor
'@ascii-fx/three': minor
---

`jitter` and `jitterSeed` work in the renderer, on both backends. jitter-v1 (ALGORITHM.md §20) lets a cell pick among the glyphs that reconstruct it nearly as well as the best one, which breaks up the banding of a wide near-tie; until now only `matchFrame` in `@ascii-fx/core` had it.

```tsx
<AsciiVideo src="/clip.mp4" color="full" jitter={40} />
```

The WebGPU matcher makes the same pick as the CPU reference for every cell, and the conformance suite holds it to that. `createAsciiRenderer`, the React components, `AsciiPass` and `<AsciiEffect>` all take the two options. `<AsciiEffect>` and `useAsciiEffect` also take `palette` and `post`, which `AsciiPass` already supported, and the React components now type `matcher` and `hysteresis`.
