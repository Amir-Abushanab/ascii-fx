import type { AsciiProfile, RawImage, StructuralCells } from '@ascii-fx/core'
import { bandSourceRows } from '@ascii-fx/core'
import type { BandOptions, CellsResponse, MatchRequest, WorkerResponse } from './matchProtocol.js'

/** Bands are whole cell rows, so a grid shorter than the pool just uses fewer workers. */
const DEFAULT_WORKERS = 4
const MAX_WORKERS = 8
/**
 * A worker that neither reports ready nor errors is the failure mode that costs
 * most: matching quietly stays on the main thread and nothing anywhere says so.
 */
const READY_TIMEOUT_MS = 5000

const workerCountFor = (requested?: number): number => {
  if (requested !== undefined) return Math.max(1, Math.min(MAX_WORKERS, Math.floor(requested)))
  const cores =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : DEFAULT_WORKERS
  // Leave a core for the main thread's extract + composite, which run concurrently.
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1))
}

/**
 * A pool of matcher workers (spec §11 tier 2). It owns no algorithm: each
 * worker runs core's `reduceBand`/`matchBand`, and the assembled result is
 * byte-identical to `matchFrame` on the same source — see the band tests in
 * @ascii-fx/core. One frame is in flight at a time; a submit while busy is
 * refused rather than queued, so a slow frame drops instead of piling up.
 */
export class MatchPool {
  private readonly workers: Worker[] = []
  private readyCount = 0
  private generation = 0
  private outstanding = 0
  private assembling?: StructuralCells
  private latest?: StructuralCells
  private dead = false
  private nextWorker = 0
  private readyTimer?: ReturnType<typeof setTimeout>

  private constructor(
    profile: AsciiProfile,
    count: number,
    private readonly onFailure?: (err: Error) => void,
  ) {
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./matchWorker.js', import.meta.url), { type: 'module' })
      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) =>
        this.receive(event.data),
      )
      worker.addEventListener('error', (event) =>
        this.fail(new Error(event.message || 'matcher worker failed')),
      )
      worker.addEventListener('messageerror', () =>
        this.fail(new Error('matcher worker message could not be read')),
      )
      // Worker.postMessage has no targetOrigin; that rule is about window.postMessage.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      worker.postMessage({ type: 'init', profile })
      this.workers.push(worker)
    }
    this.readyTimer = setTimeout(() => {
      if (!this.ready) {
        this.fail(
          new Error(
            `only ${this.readyCount} of ${count} matcher workers started within ${READY_TIMEOUT_MS} ms`,
          ),
        )
      }
    }, READY_TIMEOUT_MS)
  }

  /**
   * Spin up a pool, or `undefined` where workers are unavailable or refuse to
   * start — the caller keeps matching on the main thread, which is slower and
   * never different.
   */
  static create(
    profile: AsciiProfile,
    workers?: number,
    onFailure?: (err: Error) => void,
  ): MatchPool | undefined {
    if (typeof Worker === 'undefined') return undefined
    try {
      return new MatchPool(profile, workerCountFor(workers), onFailure)
    } catch {
      return undefined
    }
  }

  get ready(): boolean {
    return !this.dead && this.readyCount === this.workers.length
  }

  get busy(): boolean {
    return this.outstanding > 0
  }

  get failed(): boolean {
    return this.dead
  }

  /** Consume the newest completed match, if one has landed since the last call. */
  take(): StructuralCells | undefined {
    const out = this.latest
    this.latest = undefined
    return out
  }

  /**
   * Split `source` into row bands and dispatch them. Returns false when the
   * pool is not ready, already working, or dead — the caller then matches on
   * the main thread for that frame.
   */
  submit(source: RawImage, columns: number, rows: number, options: BandOptions): boolean {
    if (!this.ready || this.busy) return false

    const count = Math.min(this.workers.length, rows)
    const per = Math.ceil(rows / count)
    const n = columns * rows
    const generation = ++this.generation
    this.assembling = {
      glyphIds: new Uint16Array(n),
      flags: new Uint16Array(n),
      foreground: options.color !== 'mono' ? new Uint32Array(n) : undefined,
      background: options.color === 'full' ? new Uint32Array(n) : undefined,
    }

    const jobs: MatchRequest[] = []
    for (let rowStart = 0; rowStart < rows; rowStart += per) {
      const rowEnd = Math.min(rows, rowStart + per)
      const { y0, y1 } = bandSourceRows(source.height, rows, rowStart, rowEnd)
      // slice() always allocates a fresh exact-size buffer, so the view below
      // owns it outright and is safe to transfer.
      const strip = source.data.slice(y0 * source.width * 4, y1 * source.width * 4)
      const bytes = new Uint8Array(strip.buffer, strip.byteOffset, strip.byteLength)
      jobs.push({
        type: 'match',
        generation,
        columns,
        rows,
        rowStart,
        rowEnd,
        width: source.width,
        sourceHeight: source.height,
        yOffset: y0,
        stripHeight: y1 - y0,
        strip: bytes.buffer as ArrayBuffer,
        options,
      })
    }

    this.outstanding = jobs.length
    for (const job of jobs) {
      const worker = this.workers[this.nextWorker++ % this.workers.length]
      worker.postMessage(job, [job.strip])
    }
    return true
  }

  /**
   * Drop the in-flight frame. Its options no longer describe what the caller
   * wants, and adopting it would show one frame matched against the old ones.
   */
  abandon(): void {
    this.generation++
    this.outstanding = 0
    this.assembling = undefined
    this.latest = undefined
  }

  destroy(): void {
    this.dead = true
    if (this.readyTimer !== undefined) clearTimeout(this.readyTimer)
    this.readyTimer = undefined
    this.outstanding = 0
    this.assembling = undefined
    this.latest = undefined
    for (const worker of this.workers) worker.terminate()
    this.workers.length = 0
  }

  private receive(msg: WorkerResponse): void {
    if (msg.type === 'ready') {
      this.readyCount++
      if (this.ready && this.readyTimer !== undefined) {
        clearTimeout(this.readyTimer)
        this.readyTimer = undefined
      }
      return
    }
    if (msg.type === 'error') {
      this.fail(new Error(msg.message))
      return
    }
    // A reply from an abandoned generation: its assembly buffer is already gone.
    if (msg.generation !== this.generation || !this.assembling) return
    this.absorb(msg)
    if (--this.outstanding === 0) {
      this.latest = this.assembling
      this.assembling = undefined
    }
  }

  private absorb(msg: CellsResponse): void {
    const target = this.assembling
    if (!target) return
    const columns = msg.glyphIds.length / (msg.rowEnd - msg.rowStart)
    const at = msg.rowStart * columns
    target.glyphIds.set(msg.glyphIds, at)
    target.flags.set(msg.flags, at)
    if (target.foreground && msg.foreground) target.foreground.set(msg.foreground, at)
    if (target.background && msg.background) target.background.set(msg.background, at)
  }

  private fail(err: Error): void {
    if (this.dead) return
    this.destroy()
    this.onFailure?.(err)
  }
}
