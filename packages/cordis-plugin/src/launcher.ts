/**
 * Pure path, URL, and child-process helpers for the macOS surface plugin.
 * @module @deepseek-ai/dsh-macos-surface/launcher
 */

import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { ChildProcess } from 'node:child_process'

/** Native application bundle name shared with the Swift package. */
export const APPLICATION_NAME = 'DeepSeek Harness Desktop'

/** Default relative location of the development application bundle. */
export const DEFAULT_APPLICATION_PATH = join('dist', `${APPLICATION_NAME}.app`)

/** Command-line mode configured for the Cordis adapter. */
export type LaunchMode = 'launch-if-needed' | 'attach-only'

/** Environment values used while resolving the application artifact. */
export interface DesktopEnvironment {
  /** Explicit application bundle path, when supplied by the deployment. */
  DSH_DESKTOP_APP_PATH?: string
}

/** Child-process operations required by lifecycle ownership. */
export type OwnedDesktopProcess = Pick<
  ChildProcess,
  'exitCode' | 'signalCode' | 'kill' | 'once' | 'off' | 'on'
>

/** Process-spawn function accepted by {@link launchDesktopProcess}. */
export type DesktopSpawn = (
  executable: string,
  args: readonly string[],
  options: { stdio: 'ignore' },
) => OwnedDesktopProcess

/** Resolve the canonical loopback attachment URL for a listening Web Host. */
export function resolveAttachmentUrl(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`macos-surface: invalid webServer port ${String(port)}`)
  }
  return `http://127.0.0.1:${String(port)}`
}

/**
 * Resolve configured application input without touching the filesystem.
 * @param applicationPath - plugin config value, if present.
 * @param environment - deployment environment values.
 * @param repositoryRoot - desktop repository root used by the development default.
 * @param cwd - working directory for explicit relative paths.
 * @returns an absolute `.app` path.
 */
export function resolveApplicationPath(
  applicationPath: string | undefined,
  environment: DesktopEnvironment,
  repositoryRoot: string,
  cwd: string,
): string {
  const configured = applicationPath ?? environment.DSH_DESKTOP_APP_PATH
  if (configured === undefined) return join(repositoryRoot, DEFAULT_APPLICATION_PATH)
  return isAbsolute(configured) ? configured : resolve(cwd, configured)
}

/**
 * Validate a macOS application bundle and return its native executable path.
 * @param applicationPath - absolute or caller-resolved `.app` path.
 * @returns the executable inside `Contents/MacOS`.
 * @throws an actionable artifact diagnostic when the bundle or executable is unusable.
 */
export function resolveApplicationExecutable(applicationPath: string): string {
  const executable = join(applicationPath, 'Contents', 'MacOS', APPLICATION_NAME)
  try {
    if (!statSync(applicationPath).isDirectory()) throw new Error('not a directory')
    if (!statSync(executable).isFile()) throw new Error('not a file')
    accessSync(executable, constants.X_OK)
  } catch (cause) {
    throw new Error(
      `macos-surface: application artifact is unavailable at ${JSON.stringify(applicationPath)}; `
      + `expected executable ${JSON.stringify(executable)}. Build the desktop app or set applicationPath/DSH_DESKTOP_APP_PATH.`,
      { cause },
    )
  }
  return executable
}

/**
 * Start one owned native application process and wait until Node confirms spawn.
 * @param executable - validated native application executable.
 * @param attachmentUrl - exact loopback Host URL supplied through `--url`.
 * @param timeoutMs - positive spawn deadline.
 * @param spawnProcess - child-process implementation; production uses `node:child_process`.
 * @param reportRuntimeError - observer for errors emitted after successful spawn.
 * @returns the child owned by the calling plugin effect.
 */
export function launchDesktopProcess(
  executable: string,
  attachmentUrl: string,
  timeoutMs: number,
  spawnProcess: DesktopSpawn = spawn,
  reportRuntimeError: (error: Error) => void = () => {},
): Promise<OwnedDesktopProcess> {
  return new Promise((resolvePromise, rejectPromise) => {
    let child: OwnedDesktopProcess
    try {
      child = spawnProcess(executable, ['--url', attachmentUrl], { stdio: 'ignore' })
    } catch (cause) {
      rejectPromise(new Error(
        `macos-surface: failed to start ${JSON.stringify(executable)} with --url ${attachmentUrl}`,
        { cause },
      ))
      return
    }

    let settled = false
    const clearListeners = (): void => {
      clearTimeout(timer)
      child.off('spawn', handleSpawn)
      child.off('error', handleError)
      child.off('exit', handleEarlyExit)
    }
    const rejectLaunch = (error: Error): void => {
      if (settled) return
      settled = true
      clearListeners()
      rejectPromise(error)
    }
    const handleError = (cause: Error): void => {
      rejectLaunch(new Error(
        `macos-surface: failed to start ${JSON.stringify(executable)} with --url ${attachmentUrl}`,
        { cause },
      ))
    }
    const handleEarlyExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      rejectLaunch(new Error(
        `macos-surface: ${JSON.stringify(executable)} exited before launch confirmation `
        + `(code=${String(code)}, signal=${String(signal)})`,
      ))
    }
    const handleSpawn = (): void => {
      if (settled) return
      settled = true
      clearListeners()
      child.on('error', reportRuntimeError)
      resolvePromise(child)
    }
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      rejectLaunch(new Error(
        `macos-surface: timed out after ${String(timeoutMs)}ms starting ${JSON.stringify(executable)}`,
      ))
    }, timeoutMs)

    child.once('spawn', handleSpawn)
    child.once('error', handleError)
    child.once('exit', handleEarlyExit)
  })
}

/**
 * Terminate only the process handle returned by this plugin's own spawn.
 * @param child - application child owned by the current Cordis effect.
 * @param timeoutMs - graceful termination deadline before `SIGKILL`.
 * @returns settlement after exit or the bounded forced-termination deadline.
 */
export async function terminateDesktopProcess(child: OwnedDesktopProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolvePromise) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(forceTimer)
      child.off('exit', finish)
      child.off('error', finish)
      resolvePromise()
    }
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      finish()
    }, timeoutMs)
    child.once('exit', finish)
    child.once('error', finish)
    if (!child.kill('SIGTERM')) finish()
  })
}
