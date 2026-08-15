#!/usr/bin/env node
import { access, readFile, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  APP_ICON_FILENAME,
  BUNDLE_IDENTIFIER,
  CORDIS_PACKAGE_NAME,
  PRODUCT_NAME,
  STARTUP_GLYPH_FILENAME,
  parseArguments,
  readPluginMetadata,
  repositoryRoot,
} from './lib/contracts.mjs'
import {
  assertCompiledMenuContract,
  assertNativeSourceContract,
  readSafeInfoPlist,
  readSwiftSourceCorpus,
} from './lib/native-contract.mjs'
import { assertSafeMonochromeGlyph } from './generate-app-icon.mjs'

const specification = {
  '--app': { kind: 'value', name: 'app' },
  '--project-root': { kind: 'value', name: 'projectRoot' },
  '--source-root': { kind: 'value', name: 'sourceRoot' },
  '--skip-cli': { kind: 'flag', name: 'skipCli' },
  '--skip-native-contract': { kind: 'flag', name: 'skipNativeContract' },
}

function requirePattern(text, pattern, description) {
  if (!pattern.test(text)) throw new Error(`Missing ${description}`)
}

async function verifyMetadata(projectRoot) {
  const { packageJson, patchPath, patchText } = await readPluginMetadata(projectRoot)
  if (packageJson.name !== CORDIS_PACKAGE_NAME) throw new Error(`Cordis package name must be ${CORDIS_PACKAGE_NAME}`)
  requirePattern(patchText, /@deepseek-ai\/dsh-macos-surface/, `plugin reference in ${patchPath}`)
  requirePattern(patchText, /web-app/, `web-app composition in ${patchPath}`)
  return patchPath
}

async function verifyApplication(appPath, skipCli) {
  const contentsPath = join(appPath, 'Contents')
  const executablePath = join(contentsPath, 'MacOS', PRODUCT_NAME)
  const plistPath = join(contentsPath, 'Info.plist')
  const iconPath = join(contentsPath, 'Resources', APP_ICON_FILENAME)
  const glyphPath = join(contentsPath, 'Resources', STARTUP_GLYPH_FILENAME)
  const appInfo = await stat(appPath).catch(() => undefined)
  if (!appInfo?.isDirectory()) throw new Error(`Application bundle not found: ${appPath}`)
  await access(executablePath, fsConstants.X_OK).catch(() => {
    throw new Error(`Application executable is missing or not executable: ${executablePath}`)
  })
  const plist = readSafeInfoPlist(plistPath)
  if (plist.CFBundleIdentifier !== BUNDLE_IDENTIFIER) throw new Error(`Bundle identifier must be ${BUNDLE_IDENTIFIER}`)
  if (plist.CFBundleExecutable !== PRODUCT_NAME) throw new Error(`Bundle executable must be ${PRODUCT_NAME}`)
  if (plist.CFBundleIconFile !== APP_ICON_FILENAME) throw new Error(`Application icon must be ${APP_ICON_FILENAME}`)
  await access(iconPath, fsConstants.R_OK).catch(() => {
    throw new Error(`Application icon is missing: ${iconPath}`)
  })
  const glyph = await readFile(glyphPath, 'utf8').catch(() => {
    throw new Error(`Startup glyph is missing or unreadable: ${glyphPath}`)
  })
  assertSafeMonochromeGlyph(glyph, glyphPath)

  if (!skipCli) {
    const result = spawnSync(executablePath, ['--url', 'https://example.com'], { encoding: 'utf8', timeout: 10_000 })
    if (result.error) throw new Error(`Native CLI smoke failed: ${result.error.message}`)
    if (result.status === 0) throw new Error('Native CLI accepted a non-loopback attachment URL')
    const diagnostic = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim()
    if (!diagnostic) throw new Error('Native CLI rejected an invalid URL without a command-line diagnostic')
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2), specification)
  const projectRoot = resolve(options.projectRoot ?? repositoryRoot)
  const sourceRoot = resolve(options.sourceRoot ?? projectRoot)
  const appPath = resolve(options.app ?? join(projectRoot, 'dist', `${PRODUCT_NAME}.app`))
  const patchPath = await verifyMetadata(projectRoot)
  await verifyApplication(appPath, Boolean(options.skipCli))
  if (!options.skipNativeContract) {
    const source = await readSwiftSourceCorpus(join(sourceRoot, 'apps', 'macos', 'Sources'))
    assertNativeSourceContract(source)
    assertCompiledMenuContract(join(appPath, 'Contents', 'MacOS', PRODUCT_NAME))
  }
  process.stdout.write(`metadata: ${patchPath}\napplication: ${appPath}\nsmoke: ok\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
