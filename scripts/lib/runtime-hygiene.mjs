import { readFile, readdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const textExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.map', '.md', '.mjs', '.mts', '.txt', '.yml', '.yaml'])

/** Remove build-machine roots from generated text without touching runtime-relative paths. */
export async function scrubRuntimeText(root, sensitiveRoots = []) {
  let changed = 0
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile() || !textExtensions.has(extname(entry.name))) continue
      let text
      try {
        text = await readFile(path, 'utf8')
      } catch {
        continue
      }
      let sanitized = text
      for (const sensitiveRoot of sensitiveRoots) {
        if (sensitiveRoot) sanitized = sanitized.replaceAll(sensitiveRoot, '<embedded-source>')
      }
      sanitized = sanitized
        .replaceAll(/\/(?:private\/)?var\/folders\/[^\s"']*\/dsh-desktop-runtime-[^\s"']*\/workspace/g, '<embedded-source>')
        .replaceAll(/\/tmp\/dsh-desktop-runtime-[^\s"']*\/workspace/g, '<embedded-source>')
      if (sanitized !== text) {
        await writeFile(path, sanitized, 'utf8')
        changed += 1
      }
    }
  }
  await visit(root)
  return changed
}
