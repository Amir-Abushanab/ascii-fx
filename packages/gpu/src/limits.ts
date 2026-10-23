/**
 * Max glyphs the GPU matcher takes: the 16-bit glyph id. The matcher's workgroup memory does not
 * grow with the charset, so in practice the glyph atlas runs out first — it has to fit in one
 * texture of the device's maxTextureDimension2D, which AsciiEngine checks against the real device.
 */
export const MAX_GPU_GLYPHS = 65535
