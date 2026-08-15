#!/usr/bin/env node
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { PRODUCT_NAME, parseArguments, repositoryRoot } from './lib/contracts.mjs'

const specification = {
  '--app': { kind: 'value', name: 'app' },
  '--timeout-ms': { kind: 'value', name: 'timeoutMs' },
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(`${basename(command)} failed during release smoke.`)
  return result.stdout
}

function childProcesses(parentPID) {
  const output = run('/bin/ps', ['-axo', 'pid=,ppid=,command='])
  return output.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
    if (!match || Number(match[2]) !== parentPID) return []
    return [{ pid: Number(match[1]), command: match[3] }]
  })
}

async function waitForEmbeddedHost(application, expectedNode, expectedEntry, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastChildren = []
  while (Date.now() < deadline) {
    if (application.exitCode !== null || application.signalCode !== null) {
      throw new Error(`Relocated application exited before starting its Host (status ${application.exitCode ?? application.signalCode}).`)
    }
    lastChildren = childProcesses(application.pid)
    const child = lastChildren.find(candidate =>
      candidate.command.includes(expectedNode) && candidate.command.includes(expectedEntry))
    if (child) return child.pid
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  throw new Error(`Relocated application did not start its embedded Host (observed children: ${lastChildren.length}).`)
}

async function waitForReachableHost(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const output = spawnSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' })
    const match = output.stdout?.match(/127\.0\.0\.1:(\d+)\s+\(LISTEN\)/)
    if (match) {
      const response = await fetch(`http://127.0.0.1:${match[1]}`, { signal: AbortSignal.timeout(5_000) })
      if (response.ok) return
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  throw new Error('Relocated embedded Host did not become reachable.')
}

function terminate(pid, signal = 'SIGTERM') {
  try {
    process.kill(pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2), specification)
  const timeoutMs = Number(options.timeoutMs ?? 90_000)
  const sourceApp = resolve(options.app ?? join(repositoryRoot, 'dist/release', `${PRODUCT_NAME}.app`))
  await access(join(sourceApp, 'Contents/MacOS', PRODUCT_NAME), fsConstants.X_OK)
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-release-app-smoke-'))
  const relocatedApp = join(temporary, 'Relocated', `${PRODUCT_NAME}.app`)
  const home = join(temporary, 'home')
  await mkdir(join(temporary, 'Relocated'), { recursive: true })
  await mkdir(home)
  run('/bin/cp', ['-cR', sourceApp, relocatedApp])

  const executable = join(relocatedApp, 'Contents/MacOS', PRODUCT_NAME)
  const expectedNode = join(relocatedApp, 'Contents/Resources/runtime/node/bin/node')
  const expectedEntry = join(relocatedApp, 'Contents/Resources/runtime/host/node_modules/@deepseek-ai/dsh/lib/bin.js')
  const application = spawn(executable, [], {
    cwd: temporary,
    env: {
      HOME: home,
      PATH: '/usr/bin:/bin',
      TMPDIR: temporary,
      LANG: 'en_US.UTF-8',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let applicationOutput = ''
  const collectOutput = chunk => { applicationOutput = `${applicationOutput}${chunk.toString()}`.slice(-8_000) }
  application.stdout.on('data', collectOutput)
  application.stderr.on('data', collectOutput)
  let hostPID
  try {
    hostPID = await waitForEmbeddedHost(application, expectedNode, expectedEntry, timeoutMs)
    await waitForReachableHost(hostPID, timeoutMs)
    process.stdout.write('relocated application: embedded Host ready and reachable\n')
  } catch (error) {
    const sanitized = applicationOutput
      .replaceAll(/\/Users\/[^/\s]+\/[\w./@+~=:-]+/g, '<local-path>')
      .replaceAll(/\/(?:private\/)?(?:var\/folders|tmp)\/[\w./@+~=:-]+/g, '<temporary-path>')
    throw new Error(`${error instanceof Error ? error.message : String(error)}${sanitized ? `\n${sanitized}` : ''}`)
  } finally {
    if (application.pid) terminate(application.pid)
    if (hostPID) terminate(hostPID)
    await new Promise(resolveWait => setTimeout(resolveWait, 500))
    if (application.pid) terminate(application.pid, 'SIGKILL')
    if (hostPID) terminate(hostPID, 'SIGKILL')
    await rm(temporary, { recursive: true, force: true })
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
