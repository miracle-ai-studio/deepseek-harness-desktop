#!/usr/bin/env node
import { access, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { resolveHarnessRoot } from './lib/contracts.mjs'

const allowedTools = new Set(['tsc', 'tsx', 'vitest'])

async function main() {
  const [tool, ...arguments_] = process.argv.slice(2)
  if (!tool) throw new Error(`Expected an upstream tool name: ${[...allowedTools].join(', ')}`)
  if (!allowedTools.has(tool)) throw new Error(`Unsupported upstream tool ${tool}; allowed: ${[...allowedTools].join(', ')}`)

  const harnessRoot = await resolveHarnessRoot()
  const executable = join(harnessRoot, 'node_modules', '.bin', tool)
  const info = await stat(executable).catch(() => undefined)
  if (!info?.isFile()) throw new Error(`Upstream ${tool} executable is missing: ${executable}`)
  await access(executable, fsConstants.X_OK).catch(() => {
    throw new Error(`Upstream ${tool} executable is not executable: ${executable}`)
  })

  const child = spawn(executable, arguments_, { cwd: process.cwd(), env: process.env, stdio: 'inherit' })
  child.once('error', (error) => {
    process.stderr.write(`Unable to start upstream ${tool}: ${error.message}\n`)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    if (signal) {
      process.stderr.write(`Upstream ${tool} terminated by ${signal}\n`)
      process.exitCode = 1
      return
    }
    process.exitCode = code ?? 1
  })
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
