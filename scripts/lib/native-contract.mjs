import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { APP_ICON_FILENAME, BUNDLE_IDENTIFIER, PRODUCT_NAME } from './contracts.mjs'

export const STANDARD_MENU_TITLES = [
  'Close Window',
  'Reload',
  'Find',
  'Actual Size',
  'Zoom In',
  'Zoom Out',
  'Enter Full Screen',
  'Minimize',
  'Zoom Window',
  'Bring All to Front',
]

const compiledResponderSelectors = [
  'arrangeInFront:',
  'actualSize:',
  'copy:',
  'cut:',
  'findNext:',
  'findPrevious:',
  'paste:',
  'performClose:',
  'performMiniaturize:',
  'performZoom:',
  'reloadPage:',
  'selectAll:',
  'showFind:',
  'toggleFullScreen:',
  'zoomIn:',
  'zoomOut:',
]

const sourceRequirements = [
  ['main menu installation', /installMainMenu\s*\(/],
  ['Close Window command', /Close Window/],
  ['Reload command', /Reload/],
  ['Find command', /Find/],
  ['Actual Size command', /Actual Size/],
  ['Zoom In command', /Zoom In/],
  ['Zoom Out command', /Zoom Out/],
  ['Enter Full Screen command', /Enter Full Screen/],
  ['Minimize command', /Minimize/],
  ['Zoom Window command', /Zoom Window/],
  ['Bring All to Front command', /Bring All to Front/],
  ['Cut responder-chain selector', /(?:cut:|cut\s*\(_:\))/],
  ['Copy responder-chain selector', /(?:copy:|copy\s*\(_:\))/],
  ['Paste responder-chain selector', /(?:paste:|paste\s*\(_:\))/],
  ['Select All responder-chain selector', /(?:selectAll:|selectAll\s*\(_:\))/],
  ['Close Window responder-chain selector', /performClose\s*\(_:\)/],
  ['Minimize responder-chain selector', /performMiniaturize\s*\(_:\)/],
  ['Zoom Window responder-chain selector', /performZoom\s*\(_:\)/],
  ['Full Screen responder-chain selector', /toggleFullScreen\s*\(_:\)/],
  ['Bring All to Front responder-chain selector', /arrangeInFront\s*\(_:\)/],
  ['active browser command target', /browserController\?\.(?:reloadPage|showFind|actualSize|zoomIn|zoomOut)/],
  ['native WebKit find', /webView\.find\s*\(/],
  ['download navigation policy', /\.download/],
  ['WKDownload delegate', /WKDownloadDelegate/],
  ['download destination delegate', /decideDestinationUsing/],
  ['download redirect delegate', /willPerformHTTPRedirection/],
  ['download authentication delegate', /func download\s*\([\s\S]{0,500}?didReceive\s+challenge/],
  ['download authentication denial', /func download\s*\([\s\S]{0,900}?didReceive\s+challenge[\s\S]{0,500}?cancelAuthenticationChallenge/],
  ['download redirect denial', /willPerformHTTPRedirection[\s\S]{0,700}?decisionHandler\s*\(\s*\.cancel\s*\)/],
  ['same-origin session export endpoint', /\/api\/session\.export/],
  ['save panel', /NSSavePanel/],
  ['cancelled download suppression', /cancelledDownloads/],
  ['open panel delegate', /runOpenPanelWith/],
  ['open panel parameters', /WKOpenPanelParameters/],
  ['open panel', /NSOpenPanel/],
  ['media capture permission delegate', /requestMediaCapturePermissionFor/],
  ['media capture denial', /decisionHandler\s*\(\s*\.deny\s*\)/],
  ['Web content process recovery', /webViewWebContentProcessDidTerminate/],
  ['attach-mode retry to validated origin', /showBrowser\s*\(\s*origin:\s*origin\s*\)/],
  ['owner-mode fresh Host retry', /restartOwnedHost/],
  ['bounded automatic recovery state', /(?:maximum|max)[A-Za-z]*(?:Reload|Recovery|Retry|Attempt)/i],
  ['same-origin or inert subframe policy', /about:blank/],
  ['delayed owned Host termination', /applicationShouldTerminate\s*\([^)]*\)[\s\S]*?\.terminateLater/],
  ['owned Host exit reply', /reply\s*\(\s*toApplicationShouldTerminate:/],
  ['bounded Host stop', /stopAndWait/],
  ['native tabs disabled', /tabbingMode\s*=\s*\.disallowed/],
  ['60-second Host readiness default', /func start\s*\(\s*timeout:\s*TimeInterval\s*=\s*60\s*\)/],
  ['validated Host readiness deadline', /HostReadinessDeadline\s*\(\s*seconds:\s*timeout\s*\)/],
  ['deadline-derived readiness diagnostic', /diagnosticSeconds/],
  ['embedded runtime manifest locator', /EmbeddedRuntimeLocator/],
  ['embedded owner launch', /embeddedOwner/],
]

const forbiddenSourcePatterns = [
  ['native Undo menu interception', /withTitle:\s*"Undo"/],
  ['native Redo menu interception', /withTitle:\s*"Redo"/],
  ['JavaScript window.find injection', /window\.find\s*\(/],
  ['product DOM query from native code', /document\.querySelector\s*\(/],
  ['general JavaScript message bridge', /WKScriptMessageHandler|addScriptMessageHandler/],
  ['compiled absolute Swift source anchor', /#filePath/],
  ['raw Host diagnostics in user-visible errors', /\\\(diagnostics\\\)/],
]

/**
 * Read every native Swift source file in stable path order.
 * @param {string} sourceDirectory `apps/macos/Sources` path.
 * @returns {Promise<string>} Source corpus with file boundaries.
 */
export async function readSwiftSourceCorpus(sourceDirectory) {
  const files = []
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith('.swift')) files.push(path)
    }
  }
  await visit(sourceDirectory)
  if (files.length === 0) throw new Error(`No Swift sources found under ${sourceDirectory}`)
  const sections = await Promise.all(files.map(async path => `// FILE ${path}\n${await readFile(path, 'utf8')}`))
  return sections.join('\n')
}

/**
 * Verify frozen native menu, file interaction, and recovery entry points.
 * @param {string} source Swift source corpus.
 */
export function assertNativeSourceContract(source) {
  for (const [description, pattern] of sourceRequirements) {
    if (!pattern.test(source)) throw new Error(`Missing native contract entry: ${description}`)
  }
  for (const [description, pattern] of forbiddenSourcePatterns) {
    if (pattern.test(source)) throw new Error(`Forbidden native contract entry: ${description}`)
  }
  const statusMatch = /\/\/ FILE [^\n]*StatusViewController\.swift\n([\s\S]*?)(?=\n\/\/ FILE |$)/.exec(source)
  if (!statusMatch) throw new Error('Missing native contract entry: StatusViewController source')
  assertStartupPresentationContract(statusMatch[1])
}

/**
 * Verify the native pre-WebView loading presentation and its animation lifecycle.
 * @param {string} source Status view source.
 */
export function assertStartupPresentationContract(source) {
  const requirements = [
    ['Simplified Chinese loading text', /正在/],
    ['Simplified Chinese failure text', /无法/],
    ['Simplified Chinese retry text', /重试/],
    ['generated DeepSeek SVG glyph', /DeepSeekGlyph/],
    ['assembled application resource lookup', /Bundle\.main/],
    ['template image mode', /isTemplate\s*=\s*true/],
    ['label-color tint', /contentTintColor\s*=\s*\.labelColor/],
    ['Reduce Motion policy', /accessibilityDisplayShouldReduceMotion/],
    ['Core Animation implementation', /CA(?:Basic|Keyframe|AnimationGroup)Animation/],
    ['layer opacity animation', /opacity/],
    ['layer transform animation', /transform/],
    ['scale entrance animation', /transform\.scale/],
    ['horizontal light sweep', /light(?:Bar|Beam)|beam|sweep/i],
    ['horizontal motion', /transform\.translation\.x|position\.x|frame\.origin\.x/],
    ['visible animation start', /viewDidAppear[\s\S]{0,500}?(?:start|restart)[A-Za-z]*Animation/i],
    ['hidden animation stop', /viewWillDisappear[\s\S]{0,500}?stop[A-Za-z]*Animation/i],
    ['animation removal', /removeAllAnimations|removeAnimation/],
  ]
  for (const [description, pattern] of requirements) {
    if (!pattern.test(source)) throw new Error(`Missing startup presentation entry: ${description}`)
  }
  for (const [description, pattern] of [
    ['startup WKWebView', /WKWebView/],
    ['startup WebKit script bridge', /WKScript|evaluateJavaScript|window\./],
    ['startup JavaScript animation runtime', /\bGSAP\b|\bgsap\b/],
    ['system application icon tile', /applicationIconImage/],
    ['startup spinner', /NSProgressIndicator/],
    ['startup halo', /\bhalo\b/i],
    ['startup activity dots', /activityDots?|dotLayer|dotsContainer/i],
  ]) {
    if (pattern.test(source)) throw new Error(`Forbidden startup presentation entry: ${description}`)
  }
}

/**
 * Parse and validate the assembled Info.plist using Apple's parser.
 * @param {string} plistPath Absolute or working-directory-relative property-list path.
 * @param {(command: string, args: string[], options: object) => import('node:child_process').SpawnSyncReturns<string>} [run] Process runner.
 * @returns {Record<string, unknown>} Parsed metadata.
 */
export function readSafeInfoPlist(plistPath, run = spawnSync) {
  const result = run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], { encoding: 'utf8' })
  if (result.error) throw new Error(`Unable to inspect Info.plist: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Invalid Info.plist ${plistPath}: ${result.stderr || result.stdout}`)
  const plist = JSON.parse(result.stdout)
  if (plist.CFBundleIdentifier !== BUNDLE_IDENTIFIER) throw new Error(`Info.plist CFBundleIdentifier must be ${BUNDLE_IDENTIFIER}`)
  if (plist.CFBundleExecutable !== PRODUCT_NAME) throw new Error(`Info.plist CFBundleExecutable must be ${PRODUCT_NAME}`)
  if (plist.CFBundleIconFile !== APP_ICON_FILENAME) throw new Error(`Info.plist CFBundleIconFile must be ${APP_ICON_FILENAME}`)
  if (plist.CFBundlePackageType !== 'APPL') throw new Error('Info.plist CFBundlePackageType must be APPL')
  if (plist.LSMinimumSystemVersion !== '13.0') throw new Error('Info.plist LSMinimumSystemVersion must be 13.0')
  if (plist.NSHighResolutionCapable !== true) throw new Error('Info.plist must enable high-resolution rendering')
  const transport = plist.NSAppTransportSecurity
  if (transport === null || typeof transport !== 'object' || Array.isArray(transport)) {
    throw new Error('Info.plist must declare NSAppTransportSecurity')
  }
  if (transport.NSAllowsLocalNetworking !== true) throw new Error('Info.plist must allow only required local networking')
  for (const transportKey of Object.keys(transport)) {
    if (transportKey !== 'NSAllowsLocalNetworking') throw new Error(`Info.plist must not enable ${transportKey}`)
  }
  for (const prematurePurpose of ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription']) {
    if (prematurePurpose in plist) throw new Error(`Info.plist declares ${prematurePurpose} before the capability contract exists`)
  }
  return plist
}

/**
 * Verify standard command labels exist in the real compiled application executable.
 * @param {string} executablePath Native executable path.
 * @param {(command: string, args: string[], options: object) => import('node:child_process').SpawnSyncReturns<string>} [run] Process runner.
 */
export function assertCompiledMenuContract(executablePath, run = spawnSync) {
  const strings = run('/usr/bin/strings', ['-a', executablePath], { encoding: 'utf8' })
  if (strings.error) throw new Error(`Unable to inspect compiled menu selectors: ${strings.error.message}`)
  if (strings.status !== 0) throw new Error(`Unable to inspect compiled menu selectors: ${strings.stderr || strings.stdout}`)
  for (const selector of compiledResponderSelectors) {
    if (!strings.stdout.includes(selector)) throw new Error(`Compiled application is missing responder-chain selector: ${selector}`)
  }
}
