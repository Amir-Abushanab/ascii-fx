/**
 * Normalized pointer position inside `el`'s content box, each axis 0..1.
 *
 * Position comes from `offsetX`/`offsetY`, which the engine measures from the
 * element itself, rather than `clientX` minus the element's rect origin. An
 * embedded webview (a preview pane in a terminal multiplexer, for instance) can
 * report a rect origin that disagrees with where its pointer events actually
 * land, and anything derived from that origin inherits the skew.
 *
 * The divisor still comes from the rect: under page zoom WebKit reports offsets
 * in the rect's scale rather than in CSS pixels, so dividing by computed style
 * would be a whole zoom factor out. `offsetWidth` is the same box in CSS pixels,
 * so their ratio recovers that scale and converts the borders to match.
 *
 * The listener must be bound to `el` itself — `offsetX` is relative to the event
 * target, so a listener on an ancestor would measure against the wrong box.
 */
export function pointerUV(e: PointerEvent, el: HTMLElement): [u: number, v: number] {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const scale = el.offsetWidth > 0 ? r.width / el.offsetWidth : 1
  const w =
    r.width -
    ((parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0)) * scale
  const h =
    r.height -
    ((parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)) * scale
  if (!(w > 0) || !(h > 0)) return [0, 0]
  return [e.offsetX / w, e.offsetY / h]
}
