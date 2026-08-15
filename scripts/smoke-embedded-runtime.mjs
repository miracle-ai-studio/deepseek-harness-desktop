#!/usr/bin/env node
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { parseArguments, repositoryRoot } from './lib/contracts.mjs'

const specification = {
  '--runtime': { kind: 'value', name: 'runtime' },
  '--timeout-ms': { kind: 'value', name: 'timeoutMs' },
}
const readinessPattern = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)$/m

function safeDiagnostic(text) {
  return text
    .replaceAll(/\/Users\/[^/\s]+\/[\w./@+~=:-]+/g, '<local-path>')
    .replaceAll(/\/(?:private\/)?(?:var\/folders|tmp)\/[\w./@+~=:-]+/g, '<temporary-path>')
    .slice(-8_000)
}

function stopProcessGroup(child, signal = 'SIGTERM') {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise((accept, reject) => {
    const deadline = setTimeout(() => reject(new Error('Embedded Host did not stop in time.')), timeoutMs)
    child.once('exit', () => { clearTimeout(deadline); accept() })
    child.once('error', () => { clearTimeout(deadline); reject(new Error('Embedded Host process failed.')) })
  })
}

async function waitForReadiness(child, timeoutMs) {
  return await new Promise((accept, reject) => {
    let output = ''
    const finish = (error, url) => {
      clearTimeout(deadline)
      child.stdout.off('data', inspect)
      child.stderr.off('data', inspect)
      child.off('exit', exited)
      child.off('error', failed)
      if (error) reject(error)
      else accept(url)
    }
    const inspect = chunk => {
      output = `${output}${chunk.toString()}`.slice(-131_072)
      const match = readinessPattern.exec(output)
      if (match) finish(undefined, match[1])
    }
    const exited = () => finish(new Error(`Embedded Host exited before readiness.\n${safeDiagnostic(output)}`))
    const failed = () => finish(new Error('Embedded Host could not be started.'))
    const deadline = setTimeout(() => finish(new Error(`Embedded Host readiness timed out.\n${safeDiagnostic(output)}`)), timeoutMs)
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('exit', exited)
    child.once('error', failed)
  })
}

async function main() {
  const options = parseArguments(process.argv.slice(2), specification)
  const timeoutMs = Number(options.timeoutMs ?? 90_000)
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be a positive integer')
  const runtime = resolve(options.runtime ?? join(repositoryRoot, 'dist/runtime'))
  const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'))
  const node = join(runtime, manifest.nodeExecutable)
  const hostEntry = join(runtime, manifest.hostEntry)
  await access(node, fsConstants.X_OK)
  await access(hostEntry, fsConstants.R_OK)

  const isolated = await mkdtemp(join(tmpdir(), 'dsh-embedded-smoke-'))
  const home = join(isolated, 'home')
  const work = join(isolated, 'work')
  await mkdir(home)
  await mkdir(work)
  const child = spawn(node, [hostEntry, '--profile', 'web', '--port', '0'], {
    cwd: work,
    detached: true,
    env: {
      HOME: home,
      PATH: '/usr/bin:/bin',
      TMPDIR: isolated,
      LANG: 'en_US.UTF-8',
      DSH_DESKTOP_APP_OWNS_HOST: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const url = await waitForReadiness(child, timeoutMs)
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) throw new Error(`Embedded Host returned HTTP ${response.status}.`)
    process.stdout.write('embedded Host: ready and reachable\n')
  } finally {
    stopProcessGroup(child)
    await waitForExit(child, 5_000).catch(async () => {
      stopProcessGroup(child, 'SIGKILL')
      await waitForExit(child, 2_000).catch(() => {})
    })
    await rm(isolated, { recursive: true, force: true })
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
