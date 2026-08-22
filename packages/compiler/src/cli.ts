#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { decodeProfile, peekFrame } from '@ascii-fx/core'
import { type Args, enumFlag, parseArgs, positiveIntFlag, str } from './cliArgs.js'
import { buildProfile } from './profile.js'
import { buildFrame } from './frameBuild.js'
import { decodePng } from './png.js'

const USAGE = `ascii-fx — ASCII FX build-time compiler

Usage:
  ascii-fx profile build --font <file> --out <file.asciip> [--charset ascii] [--characters "<chars>"] [--id default]
                         [--shape6] [--shape6-lut]
  ascii-fx frame build --image <file.png> --profile <file.asciip> --out <file.asciif>
                       [--columns N] [--rows N] [--color mono|foreground|full] [--alpha mask|ignore]
  ascii-fx inspect <file.asciip | file.asciif>
`

const requireStr = (args: Args, key: string): string => {
  const v = str(args, key)
  if (v === undefined) {
    console.error(`Missing required --${key}\n\n${USAGE}`)
    process.exit(1)
  }
  return v
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const [cmd, sub] = args.positional

  if (cmd === 'profile' && sub === 'build') {
    const fontPath = requireStr(args, 'font')
    const outPath = requireStr(args, 'out')
    const font = new Uint8Array(await readFile(fontPath))
    const characters = str(args, 'characters')
    const { profile, binary } = buildProfile({
      font,
      id: str(args, 'id') ?? 'default',
      charset: str(args, 'charset'),
      characters,
      shape6:
        args.flags.get('shape6-lut') === true ? { lut: true } : args.flags.get('shape6') === true,
    })
    await writeFile(outPath, binary)
    console.log(
      `${outPath}: ${profile.glyphCount} glyphs (${profile.metadata.charset}), ` +
        `cell ${profile.atlas.cellWidth}×${profile.atlas.cellHeight}, atlas ${profile.atlas.width}×${profile.atlas.height}, ` +
        `${binary.length} bytes, fingerprint ${profile.fingerprint.slice(0, 12)}…`,
    )
    return
  }

  if (cmd === 'frame' && sub === 'build') {
    const imagePath = requireStr(args, 'image')
    const profilePath = requireStr(args, 'profile')
    const outPath = requireStr(args, 'out')
    if (!imagePath.toLowerCase().endsWith('.png')) {
      console.error('frame build currently decodes PNG only.')
      process.exit(1)
    }
    const profile = decodeProfile(new Uint8Array(await readFile(profilePath)))
    const image = decodePng(new Uint8Array(await readFile(imagePath)))
    const { frame, binary } = buildFrame({
      image,
      profile,
      columns: positiveIntFlag('columns', str(args, 'columns')),
      rows: positiveIntFlag('rows', str(args, 'rows')),
      color:
        enumFlag('color', str(args, 'color'), ['mono', 'foreground', 'full'] as const) ?? 'mono',
      alpha: enumFlag('alpha', str(args, 'alpha'), ['mask', 'ignore'] as const),
    })
    await writeFile(outPath, binary)
    console.log(
      `${outPath}: ${frame.columns}×${frame.rows} cells, ${frame.colorMode}, ${binary.length} bytes`,
    )
    return
  }

  if (cmd === 'inspect') {
    const file = args.positional[1]
    if (!file) {
      console.error(USAGE)
      process.exit(1)
    }
    const bytes = new Uint8Array(await readFile(file))
    if (bytes[3] === 0x49) {
      const p = decodeProfile(bytes)
      console.log(
        JSON.stringify(
          {
            format: 'asciip/1',
            id: p.id,
            charset: p.metadata.charset,
            fontFamily: p.metadata.fontFamily,
            glyphCount: p.glyphCount,
            cell: `${p.atlas.cellWidth}×${p.atlas.cellHeight}`,
            baseline: p.metrics.baseline,
            atlas: `${p.atlas.width}×${p.atlas.height} (pitch ${p.atlas.pitchWidth}×${p.atlas.pitchHeight})`,
            fingerprint: p.fingerprint,
            fontHash: p.fontHash,
            charsetHash: p.charsetHash,
            compilerVersion: p.metadata.compilerVersion,
            bytes: bytes.length,
          },
          null,
          2,
        ),
      )
    } else {
      const m = peekFrame(bytes)
      console.log(JSON.stringify({ format: 'asciif/1', ...m, bytes: bytes.length }, null, 2))
    }
    return
  }

  console.error(USAGE)
  process.exit(cmd === undefined ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
