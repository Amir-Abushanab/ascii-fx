/// <reference lib="webworker" />
import type { AsciiProfile, StructuralCells } from '@ascii-fx/core'
import { matchBand, reduceBand } from '@ascii-fx/core'
import type { CellsResponse, MatchRequest, WorkerRequest, WorkerResponse } from './matchProtocol.js'

// Matcher worker (spec §13). It runs the same `reduceBand`/`matchBand` the CPU
// backend runs — there is no worker-specific matcher, so there is nothing here
// that can disagree with the reference.

let profile: AsciiProfile | undefined

/**
 * This worker's previous band, for exact temporal reuse (spec §21). Keyed on
 * everything that decides a cell, so a grid resize, a band reshuffle, an option
 * change, or a new profile all miss and re-match from scratch rather than
 * serving cells matched against something else.
 */
let prev: { key: string; reduced: Uint8Array; cells: StructuralCells } | undefined

const reuseKey = (msg: MatchRequest): string => {
  const o = msg.options
  return [
    msg.columns,
    msg.rows,
    msg.rowStart,
    msg.rowEnd,
    o.color,
    o.alpha,
    o.flatThreshold ?? '',
    o.foreground?.join(',') ?? '',
    o.background?.join(',') ?? '',
  ].join('|')
}

/** Detached buffers are useless to us, so retention copies before the reply transfers. */
const retain = (cells: StructuralCells): StructuralCells => ({
  glyphIds: new Uint16Array(cells.glyphIds),
  flags: new Uint16Array(cells.flags),
  foreground: cells.foreground && new Uint32Array(cells.foreground),
  background: cells.background && new Uint32Array(cells.background),
})

const post = (msg: WorkerResponse, transfer: Transferable[] = []): void => {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer)
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>): void => {
  const msg = event.data
  if (msg.type === 'init') {
    profile = msg.profile
    prev = undefined
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
    const key = reuseKey(msg)
    const cells = matchBand(
      reduced,
      msg.columns,
      msg.rowEnd - msg.rowStart,
      {
        profile,
        color: msg.options.color,
        alpha: msg.options.alpha,
        flatThreshold: msg.options.flatThreshold,
        foreground: msg.options.foreground,
        background: msg.options.background,
        // Inert for every option this backend exposes, but this is the only
        // place that splits a frame into bands — so if a row-dependent effect
        // (ALGORITHM.md §20) ever reaches BandOptions, it hashes against frame
        // rows rather than band-local ones and assembly stays byte-identical.
        rowOffset: msg.rowStart,
      },
      msg.options.temporal && prev?.key === key
        ? { reduced: prev.reduced, cells: prev.cells }
        : undefined,
    )
    // reduceBand hands back a fresh buffer each call, so this can hold the
    // reference; the cells cannot, they are about to be transferred away.
    prev = msg.options.temporal ? { key, reduced, cells: retain(cells) } : undefined
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
