import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Config,
  DEFAULT_LAUNCH_TIMEOUT_MS,
  apply,
  inject,
  internals,
  name,
  type Config as PluginConfig,
  type OwnedDesktopProcess,
} from '../../packages/cordis-plugin/src/index.ts'

const packageRoot = fileURLToPath(new URL('../../packages/cordis-plugin/', import.meta.url))
const originalInternals = { ...internals }

interface FakeContextResult {
  ctx: MinimalCordisContext
  dispose: () => void | Promise<void>
  settle: () => void
  rejectSettlement: (error: Error) => void
  removeWebServer: () => void
  errors: string[]
  effectLabels: string[]
}

interface MinimalCordisContext {
  webServer: { port: number }
  loader: { await: () => Promise<void> }
  get: (service: string) => { port: number } | undefined
  logger: { error: (message: unknown) => void }
  effect: (setup: () => () => void | Promise<void>, label: string) => void
}

function fakeContext(port = 40_001): FakeContextResult {
  let resolveSettlement!: () => void
  let rejectSettlement!: (error: Error) => void
  const settlement = new Promise<void>((resolve, reject) => {
    resolveSettlement = resolve
    rejectSettlement = reject
  })
  let disposer: () => void | Promise<void> = () => {}
  const errors: string[] = []
  const effectLabels: string[] = []
  const webServer = { port }
  let webServerAvailable = true
  const ctx: MinimalCordisContext = {
    webServer,
    loader: { await: () => settlement },
    get: (service: string) => service === 'webServer' && webServerAvailable ? webServer : undefined,
    logger: { error: (message: unknown) => errors.push(String(message)) },
    effect: (setup: () => () => void | Promise<void>, label: string) => {
      effectLabels.push(label)
      disposer = setup()
      return disposer
    },
  }
  return {
    ctx,
    dispose: () => disposer(),
    settle: resolveSettlement,
    rejectSettlement,
    removeWebServer: () => { webServerAvailable = false },
    errors,
    effectLabels,
  }
}

function applyFake(runtime: FakeContextResult, config: PluginConfig): void {
  // Constructing a real Context would mount Cordis lifecycle machinery; this
  // focused fake implements only the services and effect calls used by apply.
  apply(runtime.ctx as unknown as Context, config)
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

afterEach(() => {
  Object.assign(internals, originalInternals)
  vi.restoreAllMocks()
})

describe('plugin surface and config', () => {
  it('exports the conventional Cordis metadata', () => {
    expect(name).toBe('macos-surface')
    expect(inject).toEqual(['webServer', 'loader'])
  })

  it('defaults launch configuration and rejects non-positive deadlines', () => {
    expect(Config['~standard'].validate({})).toEqual({
      value: { launchMode: 'launch-if-needed', launchTimeoutMs: DEFAULT_LAUNCH_TIMEOUT_MS },
    })
    expect(Config['~standard'].validate({ launchTimeoutMs: 0 })).toHaveProperty('issues')
    expect(Config['~standard'].validate({ launchTimeoutMs: -1 })).toHaveProperty('issues')
    expect(Config['~standard'].validate({ launchMode: 'always' })).toHaveProperty('issues')
  })

  it('publishes every runtime module required by the package entrypoint', () => {
    const result = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: packageRoot,
      encoding: 'utf8',
    })) as Array<{ files: Array<{ path: string }> }>
    const files = result[0]!.files.map(file => file.path)
    expect(files).toEqual(expect.arrayContaining([
      'lib/index.js',
      'lib/launcher.js',
      'lib/types/index.d.ts',
      'lib/types/launcher.d.ts',
      'cordis.patch.yml',
      'package.json',
    ]))
  })
})

describe('Cordis lifecycle', () => {
  it('suppresses every effect when the application owns the Host', () => {
    const runtime = fakeContext()
    internals.environment = () => ({ DSH_DESKTOP_APP_OWNS_HOST: '1' })
    internals.resolveApplicationExecutable = vi.fn(() => '/unexpected')

    applyFake(runtime, {})

    expect(runtime.effectLabels).toEqual([])
    expect(internals.resolveApplicationExecutable).not.toHaveBeenCalled()
  })

  it('waits for Loader settlement before printing the exact attach-only line', async () => {
    const runtime = fakeContext(42_222)
    const lines: string[] = []
    internals.environment = () => ({})
    internals.writeLine = line => lines.push(line)
    internals.launchDesktopProcess = vi.fn()

    applyFake(runtime, { launchMode: 'attach-only', launchTimeoutMs: 50 })
    expect(lines).toEqual([])
    runtime.settle()
    await flush()

    expect(lines).toEqual(['dsh desktop: http://127.0.0.1:42222'])
    expect(internals.launchDesktopProcess).not.toHaveBeenCalled()
  })

  it('passes the exact attachment to the launcher and disposes only its returned child', async () => {
    const runtime = fakeContext(43_123)
    const child = {} as OwnedDesktopProcess
    let runtimeErrorObserver: ((error: Error) => void) | undefined
    internals.environment = () => ({})
    internals.resolveApplicationExecutable = vi.fn(() => '/Desktop.app/Contents/MacOS/DeepSeek Harness Desktop')
    internals.launchDesktopProcess = vi.fn(async (_executable, _url, _timeout, spawnProcess, reportRuntimeError) => {
      expect(spawnProcess).toBeUndefined()
      runtimeErrorObserver = reportRuntimeError
      return child
    })
    internals.terminateDesktopProcess = vi.fn(async () => {})

    const config: PluginConfig = {
      applicationPath: '/Desktop.app',
      launchMode: 'launch-if-needed',
      launchTimeoutMs: 777,
    }
    applyFake(runtime, config)
    expect(internals.launchDesktopProcess).not.toHaveBeenCalled()
    runtime.settle()
    await flush()

    expect(internals.launchDesktopProcess).toHaveBeenCalledWith(
      '/Desktop.app/Contents/MacOS/DeepSeek Harness Desktop',
      'http://127.0.0.1:43123',
      777,
      undefined,
      expect.any(Function),
    )
    runtimeErrorObserver!(new Error('later failure'))
    expect(runtime.errors).toEqual(['macos-surface: application process error: later failure'])

    await runtime.dispose()
    expect(internals.terminateDesktopProcess).toHaveBeenCalledTimes(1)
    expect(internals.terminateDesktopProcess).toHaveBeenCalledWith(child, 777)
  })

  it('reports launch rejection with its actionable diagnostic', async () => {
    const runtime = fakeContext()
    internals.environment = () => ({})
    internals.resolveApplicationExecutable = () => '/broken/executable'
    internals.launchDesktopProcess = vi.fn(async () => {
      throw new Error('failed to start "/broken/executable" with --url http://127.0.0.1:40001')
    })

    applyFake(runtime, { launchMode: 'launch-if-needed', launchTimeoutMs: 50 })
    runtime.settle()
    await flush()

    expect(runtime.errors).toEqual([
      'macos-surface: application launch failed: failed to start "/broken/executable" with --url http://127.0.0.1:40001',
    ])
  })

  it('does not launch when disposed before Loader settlement', async () => {
    const runtime = fakeContext()
    internals.environment = () => ({})
    internals.resolveApplicationExecutable = () => '/Desktop.app/executable'
    internals.launchDesktopProcess = vi.fn()

    applyFake(runtime, { launchMode: 'launch-if-needed', launchTimeoutMs: 50 })
    await runtime.dispose()
    runtime.settle()
    await flush()

    expect(internals.launchDesktopProcess).not.toHaveBeenCalled()
  })

  it('stays quiet when Loader settlement rejects', async () => {
    const runtime = fakeContext()
    const lines: string[] = []
    internals.environment = () => ({})
    internals.writeLine = line => lines.push(line)
    internals.launchDesktopProcess = vi.fn()

    applyFake(runtime, { launchMode: 'attach-only', launchTimeoutMs: 50 })
    runtime.rejectSettlement(new Error('sibling plugin failed'))
    await flush()

    expect(lines).toEqual([])
    expect(internals.launchDesktopProcess).not.toHaveBeenCalled()
    expect(runtime.errors).toEqual([])
  })

  it('does not attach after the Web Host service has unloaded', async () => {
    const runtime = fakeContext()
    const lines: string[] = []
    internals.environment = () => ({})
    internals.writeLine = line => lines.push(line)
    internals.launchDesktopProcess = vi.fn()

    applyFake(runtime, { launchMode: 'attach-only', launchTimeoutMs: 50 })
    runtime.removeWebServer()
    runtime.settle()
    await flush()

    expect(lines).toEqual([])
    expect(internals.launchDesktopProcess).not.toHaveBeenCalled()
  })
})
