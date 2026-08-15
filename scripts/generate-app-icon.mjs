#!/usr/bin/env node
import { access, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ICON_FILENAME, STARTUP_GLYPH_FILENAME, repositoryRoot, resolveHarnessRoot } from './lib/contracts.mjs'

const iconFiles = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { encoding: 'utf8' })
  if (result.error) throw new Error(`Unable to run ${command}: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(' ')} failed (${String(result.status)}):\n${result.stderr || result.stdout}`)
  }
}

/**
 * Derive a background-free monochrome glyph from the controlled official SVG.
 * @param {string} source Official SVG text.
 * @returns {string} Canonical template SVG with black path fills.
 */
export function renderMonochromeGlyph(source) {
  const viewBox = /<svg\b[^>]*\bviewBox="([^"]+)"[^>]*>/i.exec(source)?.[1]
  if (!viewBox) throw new Error('Official SVG must declare a viewBox')
  const sourcePaths = [...source.matchAll(/<path\b([^>]*)\/?\s*>/gi)]
  if (sourcePaths.length === 0) throw new Error('Official SVG must contain at least one path')
  const paths = sourcePaths.map(([, attributes]) => {
    const data = /\bd="([^"]+)"/i.exec(attributes)?.[1]
    if (!data) throw new Error('Every official SVG path must declare d')
    const fillRule = /\bfill-rule="([^"]+)"/i.exec(attributes)?.[1]
    const clipRule = /\bclip-rule="([^"]+)"/i.exec(attributes)?.[1]
    return `  <path d="${data}" fill="#000000"${fillRule ? ` fill-rule="${fillRule}"` : ''}${clipRule ? ` clip-rule="${clipRule}"` : ''}/>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n${paths.join('\n')}\n</svg>\n`
}

/**
 * Reject colored, tiled, scripted, or externally referenced startup glyphs.
 * @param {string} source SVG text.
 * @param {string} [description] Diagnostic path or label.
 */
export function assertSafeMonochromeGlyph(source, description = 'startup glyph') {
  if (!/<svg\b/i.test(source) || !/<path\b/i.test(source)) throw new Error(`${description} must contain SVG paths`)
  if (/<(?:rect|circle|ellipse|polygon|image|pattern|linearGradient|radialGradient|filter|script)\b/i.test(source)) {
    throw new Error(`${description} must not contain a background tile, image, gradient, filter, or script`)
  }
  const paths = [...source.matchAll(/<path\b([^>]*)\/?\s*>/gi)]
  for (const [, attributes] of paths) {
    if (!/\bfill="#000000"/i.test(attributes)) throw new Error(`${description} paths must use the monochrome #000000 fill`)
    if (/\b(?:style|class|stroke|opacity|href)\s*=/i.test(attributes)) throw new Error(`${description} paths must contain geometry and a single fill only`)
  }
  const colors = source.match(/#[0-9a-f]{3,8}\b/gi) ?? []
  if (colors.some(color => color.toLowerCase() !== '#000000')) throw new Error(`${description} contains a non-monochrome color`)
}

/**
 * Generate the template SVG consumed by the native loading view.
 * @param {{ resourceDirectory: string, sourcePath: string }} options Source and output paths.
 * @returns {Promise<string>} Absolute generated SVG path.
 */
export async function generateMonochromeGlyph(options) {
  const outputPath = join(resolve(options.resourceDirectory), STARTUP_GLYPH_FILENAME)
  const rendered = renderMonochromeGlyph(await readFile(resolve(options.sourcePath), 'utf8'))
  assertSafeMonochromeGlyph(rendered, outputPath)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, rendered, 'utf8')
  return outputPath
}

/**
 * Render the checked-in official DeepSeek glyph into the complete macOS iconset.
 * @param {{ resourceDirectory?: string, sourcePath?: string }} [options] Source and output location.
 * @returns {Promise<string>} Absolute generated `.icns` path.
 */
export async function generateAppIcon(options = {}) {
  if (process.platform !== 'darwin') throw new Error('AppIcon.icns generation requires macOS sips and iconutil')
  const resourceDirectory = resolve(options.resourceDirectory ?? join(repositoryRoot, 'apps/macos/Resources'))
  const sourcePath = resolve(options.sourcePath ?? join(await resolveHarnessRoot(), 'website/public/favicon.svg'))
  const outputPath = join(resourceDirectory, APP_ICON_FILENAME)
  if (extname(outputPath) !== '.icns') throw new Error(`Application icon output must end with .icns: ${outputPath}`)
  await access(sourcePath, fsConstants.R_OK).catch(() => {
    throw new Error(`Official application icon source is missing: ${sourcePath}`)
  })
  await generateMonochromeGlyph({ resourceDirectory, sourcePath })

  const scratch = await mkdtemp(join(tmpdir(), 'dsh-desktop-icon-'))
  try {
    const basePng = join(scratch, 'AppIcon-1024.png')
    const iconsetPath = join(scratch, 'AppIcon.iconset')
    await mkdir(iconsetPath)
    run('sips', ['-s', 'format', 'png', '-z', '1024', '1024', sourcePath, '--out', basePng])
    for (const [filename, size] of iconFiles) {
      const destination = join(iconsetPath, filename)
      if (size === 1024) await cp(basePng, destination)
      else run('sips', ['-z', String(size), String(size), basePng, '--out', destination])
    }
    await mkdir(dirname(outputPath), { recursive: true })
    run('iconutil', ['-c', 'icns', iconsetPath, '-o', outputPath])
    const outputInfo = await stat(outputPath)
    if (!outputInfo.isFile() || outputInfo.size === 0) throw new Error(`Generated application icon is empty: ${outputPath}`)
    return outputPath
  } finally {
    await rm(scratch, { force: true, recursive: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateAppIcon().then(
    outputPath => process.stdout.write(`${outputPath}\n`),
    error => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    },
  )
}
