/// <reference lib="webworker" />
import type { AsciiProfile } from '@ascii-fx/core'
import { matchBand, reduceBand } from '@ascii-fx/core'
import type { CellsResponse, WorkerRequest, WorkerResponse } from './matchProtocol.js'

// Matcher worker (spec §13). It runs the same `reduceBand`/`matchBand` the CPU
// backend runs — there is no worker-specific matcher, so there is nothing here
// that can disagree with the reference.

let profile: AsciiProfile | undefined

const post = (msg: WorkerResponse, transfer: Transferable[] = []): void => {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer)
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>): void => {
  const msg = event.data
  if (msg.type === 'init') {
    profile = msg.profile
    post({ type: 'ready' })
    return
  }

  if (!profile) {
    post({
      type: 'error',
      generation: msg.generation,
      message: 'worker received a band before its profile',
    })
    return
  }

  try {
    const reduced = reduceBand(
      {
        width: msg.width,
        height: msg.stripHeight,
        sourceHeight: msg.sourceHeight,
        yOffset: msg.yOffset,
        data: new Uint8Array(msg.strip),
      },
      msg.columns,
      msg.rows,
      msg.options.alpha === 'ignore',
      msg.rowStart,
      msg.rowEnd,
    )
    const cells = matchBand(reduced, msg.columns, msg.rowEnd - msg.rowStart, {
      profile,
      color: msg.options.color,
      alpha: msg.options.alpha,
      flatThreshold: msg.options.flatThreshold,
      foreground: msg.options.foreground,
      background: msg.options.background,
    })
    const reply: CellsResponse = {
      type: 'cells',
      generation: msg.generation,
      rowStart: msg.rowStart,
      rowEnd: msg.rowEnd,
      glyphIds: cells.glyphIds,
      foreground: cells.foreground,
      background: cells.background,
      flags: cells.flags,
    }
    const transfer: Transferable[] = [cells.glyphIds.buffer, cells.flags.buffer]
    if (cells.foreground) transfer.push(cells.foreground.buffer)
    if (cells.background) transfer.push(cells.background.buffer)
    post(reply, transfer)
  } catch (err) {
    post({
      type: 'error',
      generation: msg.generation,
      message: err instanceof Error ? err.message : String(err),
    })
  }
})
