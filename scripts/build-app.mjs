#!/usr/bin/env node
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PRODUCT_NAME, assembleApplication, parseArguments, repositoryRoot } from './lib/contracts.mjs'
import { generateAppIcon } from './generate-app-icon.mjs'

const specification = {
  '--configuration': { kind: 'value', name: 'configuration' },
  '--output': { kind: 'value', name: 'output' },
  '--product': { kind: 'value', name: 'product' },
  '--skip-build': { kind: 'flag', name: 'skipBuild' },
  '--runtime': { kind: 'value', name: 'runtime' },
}

function runSwift(arguments_) {
  const result = spawnSync('swift', arguments_, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error) throw new Error(`Unable to run swift: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`swift ${arguments_.join(' ')} failed (${result.status}):\n${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

function stripReleaseExecutable(path) {
  const result = spawnSync('/usr/bin/strip', ['-S', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error) throw new Error(`Unable to strip release executable: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Release executable stripping failed (${result.status}).`)
}

async function main() {
  const options = parseArguments(process.argv.slice(2), specification)
  const configuration = options.configuration ?? 'release'
  if (configuration !== 'debug' && configuration !== 'release') throw new Error(`Unsupported Swift configuration: ${configuration}`)
  const packagePath = join(repositoryRoot, 'apps/macos')
  const resourceDirectory = join(packagePath, 'Resources')
  const product = options.product ?? 'DeepSeekHarnessDesktop'
  const outputPath = resolve(options.output ?? join(repositoryRoot, 'dist', `${PRODUCT_NAME}.app`))
  await generateAppIcon({ resourceDirectory })
  if (!options.skipBuild) {
    runSwift(['build', '--package-path', packagePath, '--configuration', configuration, '--product', product])
  }
  const binDirectory = runSwift(['build', '--package-path', packagePath, '--configuration', configuration, '--show-bin-path'])
  const executablePath = join(binDirectory, product)
  await access(executablePath, fsConstants.X_OK).catch(() => {
    throw new Error(`Expected Swift product ${product} at ${executablePath}`)
  })
  const assembled = await assembleApplication({
    executablePath,
    outputPath,
    resourceDirectory,
    swiftBinDirectory: binDirectory,
    runtimeDirectory: options.runtime,
  })
  if (configuration === 'release') {
    stripReleaseExecutable(join(assembled, 'Contents', 'MacOS', PRODUCT_NAME))
  }
  process.stdout.write(`${assembled}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
