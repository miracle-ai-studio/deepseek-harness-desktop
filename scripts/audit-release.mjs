#!/usr/bin/env node
import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PRODUCT_NAME, parseArguments, repositoryRoot } from './lib/contracts.mjs'

const specification = {
  '--app': { kind: 'value', name: 'app' },
}
const forbiddenNames = new Set([
  '.DS_Store', '.env', '.modules.yaml', '.npmrc', '.pnpm-workspace-state-v1.json',
  'id_rsa', 'id_ed25519',
])

function sensitiveBytePatterns() {
  const user = process.env.USER ?? ''
  return [
    ['desktop build root', repositoryRoot],
    ['Harness build root', resolve(repositoryRoot, '../deepseek-harness')],
    ['runtime staging path', 'dsh-desktop-runtime-'],
    ['task temporary path', '/tmp/dsh-desktop'],
    ...(user ? [['local user home', `/Users/${user}/`]] : []),
  ].map(([label, value]) => ({ label, bytes: Buffer.from(value) }))
}

const credentialPatterns = [
  ['GitHub credential', /github_pat_[A-Za-z0-9_]{40,}|ghp_[A-Za-z0-9]{30,}/],
  ['API credential', /(?:OPENAI|DEEPSEEK)_API_KEY\s*=\s*["']?[A-Za-z0-9_-]{20,}/],
  ['AWS credential', /AWS_SECRET_ACCESS_KEY\s*=\s*["']?[A-Za-z0-9/+=]{30,}/],
]

async function fileContains(path, patterns) {
  let tail = Buffer.alloc(0)
  for await (const chunk of createReadStream(path)) {
    const data = Buffer.concat([tail, chunk])
    const match = patterns.find(pattern => data.includes(pattern.bytes))
    if (match) return match.label
    const text = data.toString('latin1')
    const credential = credentialPatterns.find(([, pattern]) => pattern.test(text))
    if (credential) return credential[0]
    const longest = Math.max(...patterns.map(pattern => pattern.bytes.length))
    tail = data.subarray(Math.max(0, data.length - Math.max(longest, 256) + 1))
  }
  return undefined
}

async function auditTree(root) {
  const patterns = sensitiveBytePatterns()
  let files = 0
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) throw new Error('Application contains an unresolved symbolic link.')
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile()) continue
      files += 1
      if (forbiddenNames.has(entry.name) || entry.name.startsWith('.env.') || entry.name.endsWith('.log')) {
        throw new Error(`Application contains forbidden machine-state file: ${entry.name}`)
      }
      const marker = await fileContains(path, patterns)
      if (marker) throw new Error(`Application contains ${marker} in ${path.slice(root.length + 1)}.`)
    }
  }
  await visit(root)
  return files
}

async function main() {
  const options = parseArguments(process.argv.slice(2), specification)
  const app = resolve(options.app ?? join(repositoryRoot, 'dist/release', `${PRODUCT_NAME}.app`))
  const executable = join(app, 'Contents/MacOS', PRODUCT_NAME)
  const runtime = join(app, 'Contents/Resources/runtime')
  const files = await auditTree(app)
  const fileResult = spawnSync('/usr/bin/file', [executable, join(runtime, 'node/bin/node')], { encoding: 'utf8' })
  if (fileResult.status !== 0 || !fileResult.stdout.includes('x86_64')) throw new Error('Release architecture verification failed.')
  await lstat(join(runtime, 'node/LICENSE')).catch(() => { throw new Error('Official Node.js license is missing.') })
  process.stdout.write(`release audit: ${files} files clean\n`)
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
