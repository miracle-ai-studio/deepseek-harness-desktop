/**
 * Cordis adapter that attaches DeepSeek Harness Desktop to the existing Web Host.
 * @module @deepseek-ai/dsh-macos-surface
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  launchDesktopProcess,
  resolveApplicationExecutable,
  resolveApplicationPath,
  resolveAttachmentUrl,
  terminateDesktopProcess,
  type LaunchMode,
  type OwnedDesktopProcess,
} from './launcher.ts'

/** Stable Cordis plugin name. */
export const name = 'macos-surface'

/** Cordis services required by the native surface adapter. */
export const inject = ['webServer', 'loader']

/** Default native-process startup and cleanup deadline. */
export const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000

/** Desktop repository root in both source and emitted package layouts. */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** Cordis configuration for native application attachment. */
export interface Config {
  /** Explicit `.app` path; environment and development defaults apply when absent. */
  applicationPath?: string
  /** Start the application or only expose the resolved attachment line. */
  launchMode?: LaunchMode
  /** Deadline for native process spawn and owned-process cleanup. */
  launchTimeoutMs?: number
}

/** Validated plugin configuration with deployment-safe defaults. */
export const Config: z<Config> = z.object({
  applicationPath: z.string(),
  launchMode: z.union([z.const('launch-if-needed'), z.const('attach-only')]).default('launch-if-needed'),
  launchTimeoutMs: z.number().step(1).min(1).default(DEFAULT_LAUNCH_TIMEOUT_MS),
})

/** Replaceable platform operations used by focused lifecycle tests. */
export const internals: {
  launchDesktopProcess: typeof launchDesktopProcess
  resolveApplicationExecutable: typeof resolveApplicationExecutable
  terminateDesktopProcess: typeof terminateDesktopProcess
  writeLine: (line: string) => void
  environment: () => NodeJS.ProcessEnv
} = {
  launchDesktopProcess,
  resolveApplicationExecutable,
  terminateDesktopProcess,
  writeLine: line => console.log(line),
  environment: () => process.env,
}

/** Format a lifecycle failure without discarding an `Error` message. */
function formatFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Mount the macOS surface lifecycle after the complete Loader tree settles.
 * @param ctx - Cordis context carrying the existing Loader and Web Host.
 * @param config - validated desktop launch configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const environment = internals.environment()
  if (environment.DSH_DESKTOP_APP_OWNS_HOST === '1') return
  const launchMode = config.launchMode ?? 'launch-if-needed'
  const launchTimeoutMs = config.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS

  let executable: string | undefined
  if (launchMode === 'launch-if-needed') {
    const applicationPath = resolveApplicationPath(
      config.applicationPath,
      environment,
      REPOSITORY_ROOT,
      process.cwd(),
    )
    executable = internals.resolveApplicationExecutable(applicationPath)
  }

  ctx.effect(() => {
    let cancelled = false
    let owned: OwnedDesktopProcess | undefined
    let launchTask: Promise<OwnedDesktopProcess> | undefined
    let cleaned = false

    const cleanupOwned = async (child: OwnedDesktopProcess): Promise<void> => {
      if (cleaned) return
      cleaned = true
      await internals.terminateDesktopProcess(child, launchTimeoutMs)
    }

    void ctx.loader.await().then(() => {
      if (cancelled || ctx.get('webServer') === undefined) return
      const attachmentUrl = resolveAttachmentUrl(ctx.webServer.port)
      if (launchMode === 'attach-only') {
        internals.writeLine(`dsh desktop: ${attachmentUrl}`)
        return
      }

      launchTask = internals.launchDesktopProcess(
        executable!,
        attachmentUrl,
        launchTimeoutMs,
        undefined,
        error => ctx.logger.error(`macos-surface: application process error: ${formatFailure(error)}`),
      )
      void launchTask.then(async (child) => {
        if (cancelled) await cleanupOwned(child)
        else owned = child
      }, (error: unknown) => {
        ctx.logger.error(`macos-surface: application launch failed: ${formatFailure(error)}`)
      })
    }, () => {
      // Loader owns startup failure reporting; this adapter must remain quiet.
    })

    return async () => {
      cancelled = true
      if (owned !== undefined) {
        await cleanupOwned(owned)
        return
      }
      if (launchTask !== undefined) {
        try {
          await cleanupOwned(await launchTask)
        } catch {
          // Launch failure is reported by the observer above and owns no child.
        }
      }
    }
  }, 'macos-surface: owned desktop application')
}

export {
  APPLICATION_NAME,
  DEFAULT_APPLICATION_PATH,
  launchDesktopProcess,
  resolveApplicationExecutable,
  resolveApplicationPath,
  resolveAttachmentUrl,
  terminateDesktopProcess,
  type DesktopEnvironment,
  type DesktopSpawn,
  type LaunchMode,
  type OwnedDesktopProcess,
} from './launcher.ts'
