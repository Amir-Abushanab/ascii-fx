// `@ascii-fx/gpu/webgpu`: the WebGPU backend's classes, for code that drives it directly — the
// Three.js adapter embeds an AsciiEngine in the renderer's own device. They are not on the main
// entry so that `createAsciiRenderer` alone never reaches this code statically: it loads the
// backend it picks as a chunk, which only works when nothing else imports that chunk up front.
export { WebGpuAsciiRenderer } from './renderer.js'
// The checks the renderer applies to its options, for anything else that drives the engine.
export { assertInteraction, assertJitter } from './types.js'
export {
  AsciiEngine,
  AsciiStream,
  type StreamFxState,
  type StreamMatchOptions,
  type StreamViewOptions,
} from './engine.js'
