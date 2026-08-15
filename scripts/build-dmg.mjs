#!/usr/bin/env node
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PRODUCT_NAME, parseArguments, repositoryRoot } from './lib/contracts.mjs'

const specification = {
  '--app': { kind: 'value', name: 'app' },
  '--output': { kind: 'value', name: 'output' },
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error || result.status !== 0) throw new Error('Disk image creation failed.')
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('Disk image creation requires macOS.')
  const options = parseArguments(process.argv.slice(2), specification)
  const app = resolve(options.app ?? join(repositoryRoot, 'dist/release', `${PRODUCT_NAME}.app`))
  const output = resolve(options.output ?? join(repositoryRoot, 'dist/release/DeepSeek-Harness-Desktop.dmg'))
  const releaseRoot = join(repositoryRoot, 'dist/release')
  if (!output.startsWith(releaseRoot + sep) || !output.endsWith('.dmg')) {
    throw new Error('Disk image output must be a .dmg under dist/release.')
  }
  await mkdir(dirname(output), { recursive: true })
  const staging = await mkdtemp(join(releaseRoot, '.dmg-stage-'))
  try {
    run('/bin/cp', ['-cR', app, join(staging, `${PRODUCT_NAME}.app`)])
    await symlink('/Applications', join(staging, 'Applications'))
    run('/usr/bin/hdiutil', [
      'create', '-volname', PRODUCT_NAME, '-srcfolder', staging,
      '-ov', '-format', 'UDZO', output,
    ])
    run('/usr/bin/hdiutil', ['verify', output])
    process.stdout.write('disk image: created and verified\n')
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
