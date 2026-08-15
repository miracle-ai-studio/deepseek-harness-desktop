import { EventEmitter } from 'node:events'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APPLICATION_NAME,
  launchDesktopProcess,
  resolveApplicationExecutable,
  resolveApplicationPath,
  resolveAttachmentUrl,
  terminateDesktopProcess,
  type DesktopSpawn,
} from '../../packages/cordis-plugin/src/launcher.ts'

class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly kills: NodeJS.Signals[] = []

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.kills.push(signal)
    return true
  }
}

const temporaryRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('desktop resolution', () => {
  it('resolves only valid Web Host ports to the canonical loopback URL', () => {
    expect(resolveAttachmentUrl(30_808)).toBe('http://127.0.0.1:30808')
    for (const invalid of [0, -1, 1.5, 65_536, Number.NaN]) {
      expect(() => resolveAttachmentUrl(invalid)).toThrow('invalid webServer port')
    }
  })

  it('applies config, environment, and repository defaults in that order', () => {
    expect(resolveApplicationPath('/config/App.app', { DSH_DESKTOP_APP_PATH: '/env/App.app' }, '/repo', '/cwd'))
      .toBe('/config/App.app')
    expect(resolveApplicationPath(undefined, { DSH_DESKTOP_APP_PATH: 'env/App.app' }, '/repo', '/cwd'))
      .toBe('/cwd/env/App.app')
    expect(resolveApplicationPath(undefined, {}, '/repo', '/cwd'))
      .toBe('/repo/dist/DeepSeek Harness Desktop.app')
  })

  it('validates the executable inside the application bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-macos-surface-'))
    temporaryRoots.push(root)
    const app = join(root, 'Desktop.app')
    const executable = join(app, 'Contents', 'MacOS', APPLICATION_NAME)
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
    writeFileSync(executable, '#!/bin/sh\n')
    chmodSync(executable, 0o755)

    expect(resolveApplicationExecutable(app)).toBe(executable)
    expect(() => resolveApplicationExecutable(join(root, 'Missing.app')))
      .toThrow(/Build the desktop app or set applicationPath\/DSH_DESKTOP_APP_PATH/)
  })
})

describe('owned application process', () => {
  it('spawns the exact executable with only the attach URL argument', async () => {
    const child = new FakeChild()
    const spawnProcess = vi.fn<DesktopSpawn>(() => {
      queueMicrotask(() => child.emit('spawn'))
      return child
    })

    await expect(launchDesktopProcess('/Desktop.app/Contents/MacOS/Desktop', 'http://127.0.0.1:43123', 100, spawnProcess))
      .resolves.toBe(child)
    expect(spawnProcess).toHaveBeenCalledWith(
      '/Desktop.app/Contents/MacOS/Desktop',
      ['--url', 'http://127.0.0.1:43123'],
      { stdio: 'ignore' },
    )
  })

  it('reports synchronous spawn failure with the executable and URL', async () => {
    const spawnProcess: DesktopSpawn = () => { throw new Error('denied') }
    await expect(launchDesktopProcess('/broken/executable', 'http://127.0.0.1:1234', 100, spawnProcess))
      .rejects.toThrow('failed to start "/broken/executable" with --url http://127.0.0.1:1234')
  })

  it('times out a child that never confirms spawn', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const result = launchDesktopProcess('/slow', 'http://127.0.0.1:1234', 20, () => child)
    const rejection = expect(result).rejects.toThrow('timed out after 20ms')
    await vi.advanceTimersByTimeAsync(20)
    await rejection
    expect(child.kills).toEqual(['SIGTERM'])
  })

  it('terminates only the supplied owned handle', async () => {
    const child = new FakeChild()
    const termination = terminateDesktopProcess(child, 100)
    expect(child.kills).toEqual(['SIGTERM'])
    child.signalCode = 'SIGTERM'
    child.emit('exit', null, 'SIGTERM')
    await termination
    expect(child.kills).toEqual(['SIGTERM'])
  })
})
