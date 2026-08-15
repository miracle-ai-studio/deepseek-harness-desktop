#!/usr/bin/env node
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'
import { PRODUCT_NAME, parseArguments, repositoryRoot, resolveHarnessRoot } from './lib/contracts.mjs'

const specification = {
  '--app': { kind: 'value', name: 'app' },
  '--harness-root': { kind: 'value', name: 'harnessRoot' },
  '--profile': { kind: 'value', name: 'profile' },
  '--timeout-ms': { kind: 'value', name: 'timeoutMs' },
}
const readinessPattern = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)$/m

function terminateOwnedProcess(child) {
  if (!child.pid || child.exitCode !== null) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolveExit, reject) => {
    const finish = (error) => {
      clearTimeout(deadline)
      child.off('exit', handleExit)
      child.off('error', handleError)
      if (error) reject(error)
      else resolveExit()
    }
    const handleExit = () => finish()
    const handleError = error => finish(new Error(`Owned process failed while stopping: ${error.message}`))
    const deadline = setTimeout(() => finish(new Error(`Owned process did not exit within ${timeoutMs}ms`)), timeoutMs)
    child.once('exit', handleExit)
    child.once('error', handleError)
  })
}

async function terminateOwnedProcessAndWait(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  terminateOwnedProcess(child)
  try {
    await waitForExit(child, timeoutMs)
  } catch (error) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (killError) {
        if (killError?.code !== 'ESRCH') throw killError
      }
    }
    await waitForExit(child, 2_000).catch(() => {})
    throw error
  }
}

function probeLoopback(url, timeoutMs = 2_000) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) {
    return Promise.reject(new Error(`Refusing to probe a non-contract Host URL: ${url}`))
  }
  return new Promise((resolveProbe, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(parsed.port) })
    const finish = (error) => {
      socket.removeAllListeners()
      socket.destroy()
      if (error) reject(error)
      else resolveProbe()
    }
    socket.setTimeout(timeoutMs, () => finish(new Error(`Host port did not respond within ${timeoutMs}ms: ${url}`)))
    socket.once('connect', () => finish())
    socket.once('error', error => finish(new Error(`Host port stopped after attached application exit: ${error.message}`)))
  })
}

export async function assertHostSurvivedAttachedApplication(
  host,
  url,
  probe = probeLoopback,
  verifyProcess = pid => process.kill(pid, 0),
) {
  if (!host.pid || host.exitCode !== null || host.signalCode !== null) {
    throw new Error(`Attached application terminated its Host (code=${String(host.exitCode)}, signal=${String(host.signalCode)})`)
  }
  try {
    verifyProcess(host.pid)
  } catch (error) {
    throw new Error(`Host PID ${host.pid} did not survive attached application exit`, { cause: error })
  }
  await probe(url)
}

function waitForReadiness(child, timeoutMs) {
  return new Promise((resolveReady, reject) => {
    let output = ''
    const deadline = setTimeout(() => reject(new Error(`Host did not emit its readiness line within ${timeoutMs}ms. Output:\n${output}`)), timeoutMs)
    const inspect = (chunk) => {
      output += chunk.toString()
      const match = readinessPattern.exec(output)
      if (match) {
        clearTimeout(deadline)
        resolveReady({ output, url: match[1] })
      }
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('exit', (code, signal) => {
      clearTimeout(deadline)
      reject(new Error(`Host exited before readiness (${signal ?? code}). Output:\n${output}`))
    })
    child.once('error', (error) => {
      clearTimeout(deadline)
      reject(new Error(`Unable to start Host: ${error.message}`))
    })
  })
}

async function confirmAttachedApplication(child, durationMs = 2_000) {
  await new Promise((resolveWait, reject) => {
    const deadline = setTimeout(resolveWait, durationMs)
    child.once('error', (error) => {
      clearTimeout(deadline)
      reject(new Error(`Unable to start application: ${error.message}`))
    })
    child.once('exit', (code, signal) => {
      clearTimeout(deadline)
      reject(new Error(`Attached application exited early (${signal ?? code})`))
    })
  })
}

async function main() {
  const options = parseArguments(process.argv.slice(2), specification)
  const timeoutMs = Number(options.timeoutMs ?? 60_000)
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be a positive integer')
  const harnessRoot = await resolveHarnessRoot({
    env: options.harnessRoot ? { ...process.env, DSH_HARNESS_ROOT: options.harnessRoot } : process.env,
    projectRoot: repositoryRoot,
  })
  const appPath = resolve(options.app ?? join(repositoryRoot, 'dist', `${PRODUCT_NAME}.app`))
  const executablePath = join(appPath, 'Contents', 'MacOS', PRODUCT_NAME)
  await access(executablePath, fsConstants.X_OK).catch(() => {
    throw new Error(`Build the application before assembled smoke: ${executablePath}`)
  })

  const host = spawn('node', ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', options.profile ?? 'web', '--port', '0'], {
    cwd: harnessRoot,
    detached: true,
    env: { ...process.env, DSH_DESKTOP_APP_OWNS_HOST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let application
  const stopImmediately = () => {
    if (application) terminateOwnedProcess(application)
    terminateOwnedProcess(host)
  }
  process.once('SIGINT', () => {
    stopImmediately()
    process.exitCode = 130
  })
  process.once('SIGTERM', () => {
    stopImmediately()
    process.exitCode = 143
  })

  try {
    const ready = await waitForReadiness(host, timeoutMs)
    application = spawn(executablePath, ['--url', ready.url], { detached: true, env: process.env, stdio: 'ignore' })
    await confirmAttachedApplication(application)
    await terminateOwnedProcessAndWait(application)
    application = undefined
    await assertHostSurvivedAttachedApplication(host, ready.url)
    process.stdout.write(`host: ${ready.url}\napplication: attached then terminated\nhost after application exit: alive\nassembled smoke: ok\n`)
  } finally {
    if (application) await terminateOwnedProcessAndWait(application).catch(() => {})
    await terminateOwnedProcessAndWait(host).catch(() => {})
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
