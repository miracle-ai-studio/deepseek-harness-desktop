import { access, cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { basename, dirname, join, parse, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRODUCT_NAME = 'DeepSeek Harness Desktop'
export const BUNDLE_IDENTIFIER = 'ai.deepseek.harness.desktop'
export const CORDIS_PACKAGE_NAME = '@deepseek-ai/dsh-macos-surface'
export const APP_ICON_FILENAME = 'AppIcon.icns'
export const STARTUP_GLYPH_FILENAME = 'DeepSeekGlyph.svg'
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const harnessMarkers = ['apps/cli/src/bin.ts', 'packages/bundle/web-app/package.json']

/**
 * Resolve and validate the existing DeepSeek Harness checkout.
 * @param {{ env?: NodeJS.ProcessEnv, projectRoot?: string }} [options] Resolution inputs.
 * @returns {Promise<string>} Absolute Harness checkout path.
 */
export async function resolveHarnessRoot(options = {}) {
  const env = options.env ?? process.env
  const projectRoot = resolve(options.projectRoot ?? repositoryRoot)
  const candidates = env.DSH_HARNESS_ROOT
    ? [env.DSH_HARNESS_ROOT]
    : [resolve(projectRoot, '../deepseek-harness')]
  const failures = []
  for (const candidate of candidates) {
    const root = resolve(candidate)
    const missing = []
    for (const marker of harnessMarkers) {
      try {
        await access(join(root, marker), fsConstants.R_OK)
      } catch {
        missing.push(marker)
      }
    }
    if (missing.length === 0) return root
    failures.push(`${root} (missing ${missing.join(', ')})`)
  }
  throw new Error(`Unable to locate a DeepSeek Harness checkout. Set DSH_HARNESS_ROOT. Checked: ${failures.join('; ')}`)
}

/**
 * Parse a small command-line surface while rejecting ambiguous input.
 * @param {string[]} argv Arguments excluding the Node executable and script.
 * @param {Record<string, { kind: 'flag' | 'value', name: string }>} specification Accepted flags.
 * @returns {Record<string, string | boolean>} Parsed values keyed by logical name.
 */
export function parseArguments(argv, specification) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const entry = specification[token]
    if (!entry) throw new Error(`Unknown argument: ${token}`)
    if (entry.kind === 'flag') {
      result[entry.name] = true
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`)
    result[entry.name] = value
    index += 1
  }
  return result
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * Render application metadata without depending on Xcode build tools.
 * @returns {string} Complete XML property list.
 */
export function renderInfoPlist() {
  const executable = escapeXml(PRODUCT_NAME)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>${executable}</string>
  <key>CFBundleExecutable</key><string>${executable}</string>
  <key>CFBundleIconFile</key><string>${APP_ICON_FILENAME}</string>
  <key>CFBundleIdentifier</key><string>${escapeXml(BUNDLE_IDENTIFIER)}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>${executable}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.1</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
`
}

async function validateReplaceableDirectory(path, description) {
  const info = await lstat(path).catch((error) => {
    if (error?.code === 'ENOENT') return undefined
    throw error
  })
  if (!info) return
  if (info.isSymbolicLink()) throw new Error(`${description} must not be a symbolic link: ${path}`)
  if (!info.isDirectory()) throw new Error(`${description} already exists and is not a directory: ${path}`)
}

/**
 * Validate that application replacement cannot select a broad or ambiguous target.
 * @param {string} requestedPath Requested application path.
 * @returns {Promise<{ outputPath: string, stagingPath: string }>} Safe exact target paths.
 */
export async function resolveApplicationTargets(requestedPath) {
  const outputPath = resolve(requestedPath)
  const filesystemRoot = parse(outputPath).root
  if (outputPath === filesystemRoot || outputPath === repositoryRoot || repositoryRoot.startsWith(`${outputPath}${sep}`)) {
    throw new Error(`Application output cannot be the filesystem root, project root, or a project ancestor: ${outputPath}`)
  }
  if (!outputPath.endsWith('.app')) throw new Error(`Application output must end with .app: ${outputPath}`)
  await validateReplaceableDirectory(outputPath, 'Application output')

  const stagingPath = join(dirname(outputPath), `.${basename(outputPath)}.staging-${process.pid}`)
  if (dirname(stagingPath) !== dirname(outputPath)) throw new Error(`Application staging path must be an output sibling: ${stagingPath}`)
  await validateReplaceableDirectory(stagingPath, 'Application staging output')
  return { outputPath, stagingPath }
}

/**
 * Assemble a Swift executable and its resources into a macOS application.
 * @param {{ executablePath: string, outputPath: string, resourceDirectory?: string, swiftBinDirectory?: string, runtimeDirectory?: string }} options Inputs and exact output.
 * @returns {Promise<string>} Absolute assembled application path.
 */
export async function assembleApplication(options) {
  const executablePath = resolve(options.executablePath)
  const { outputPath, stagingPath } = await resolveApplicationTargets(options.outputPath)
  const sourceInfo = await stat(executablePath).catch(() => undefined)
  if (!sourceInfo?.isFile()) throw new Error(`Swift executable not found: ${executablePath}`)
  await access(executablePath, fsConstants.X_OK).catch(() => {
    throw new Error(`Swift executable is not executable: ${executablePath}`)
  })
  const iconPath = options.resourceDirectory === undefined
    ? undefined
    : join(resolve(options.resourceDirectory), APP_ICON_FILENAME)
  if (iconPath === undefined) throw new Error('Application resources must include AppIcon.icns')
  await access(iconPath, fsConstants.R_OK).catch(() => {
    throw new Error(`Application icon is missing: ${iconPath}`)
  })
  const glyphPath = join(resolve(options.resourceDirectory), STARTUP_GLYPH_FILENAME)
  await access(glyphPath, fsConstants.R_OK).catch(() => {
    throw new Error(`Startup glyph is missing: ${glyphPath}`)
  })

  const contentsPath = join(stagingPath, 'Contents')
  const macOSPath = join(contentsPath, 'MacOS')
  const resourcesPath = join(contentsPath, 'Resources')
  await rm(stagingPath, { force: true, recursive: true })
  await mkdir(macOSPath, { recursive: true })
  await mkdir(resourcesPath, { recursive: true })
  await cp(executablePath, join(macOSPath, PRODUCT_NAME))
  await writeFile(join(contentsPath, 'Info.plist'), renderInfoPlist(), 'utf8')
  await writeFile(join(contentsPath, 'PkgInfo'), 'APPL????', 'ascii')

  if (options.resourceDirectory) {
    const resourceInfo = await stat(options.resourceDirectory).catch(() => undefined)
    if (resourceInfo?.isDirectory()) await cp(options.resourceDirectory, resourcesPath, { recursive: true })
  }
  if (options.swiftBinDirectory) {
    const entries = await readdir(options.swiftBinDirectory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('.bundle')) {
        await cp(join(options.swiftBinDirectory, entry.name), join(resourcesPath, entry.name), { recursive: true })
      }
    }
  }
  if (options.runtimeDirectory) {
    const runtimeDirectory = resolve(options.runtimeDirectory)
    const runtimeInfo = await stat(runtimeDirectory).catch(() => undefined)
    if (!runtimeInfo?.isDirectory()) throw new Error('Embedded runtime directory is missing')
    await cp(runtimeDirectory, join(resourcesPath, 'runtime'), { recursive: true })
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await rm(outputPath, { force: true, recursive: true })
  await rename(stagingPath, outputPath)
  return outputPath
}

/**
 * Read the plugin's external bundle declaration and patch.
 * @param {string} projectRoot Repository root.
 * @returns {Promise<{ packageJson: Record<string, unknown>, patchPath: string, patchText: string }>} Metadata and patch contents.
 */
export async function readPluginMetadata(projectRoot) {
  const packagePath = join(projectRoot, 'packages/cordis-plugin/package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
  const patchDeclaration = packageJson?.dsh?.bundle?.patch
  if (typeof patchDeclaration !== 'string' || patchDeclaration.length === 0) {
    throw new Error(`${packagePath} must declare dsh.bundle.patch`)
  }
  const patchPath = resolve(dirname(packagePath), patchDeclaration)
  return { packageJson, patchPath, patchText: await readFile(patchPath, 'utf8') }
}
