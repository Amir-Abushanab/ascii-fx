import type { AsciiFrame, AsciiProfile, MatchOptions, RawImage } from '@ascii-fx/core'
import { encodeFrame, matchFrame } from '@ascii-fx/core'

export interface BuildFrameOptions extends Omit<MatchOptions, 'profile'> {
  image: RawImage
  profile: AsciiProfile
}

export interface BuiltFrame {
  frame: AsciiFrame
  binary: Uint8Array
}

/** Build-time static frame: run the exact matcher now so the client never has to. */
export function buildFrame(options: BuildFrameOptions): BuiltFrame {
  const { image, ...match } = options
  const frame = matchFrame(image, match)
  return { frame, binary: encodeFrame(frame) }
}
