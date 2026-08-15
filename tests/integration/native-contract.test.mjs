import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  assertCompiledMenuContract,
  assertNativeSourceContract,
  assertStartupPresentationContract,
  readSafeInfoPlist,
  readSwiftSourceCorpus,
} from '../../scripts/lib/native-contract.mjs'
import { repositoryRoot } from '../../scripts/lib/contracts.mjs'

test('native Swift sources expose the frozen interaction and recovery entries', async () => {
  const source = await readSwiftSourceCorpus(join(repositoryRoot, 'apps', 'macos', 'Sources'))
  assertNativeSourceContract(source)
})

test('native source contract rejects menu interception and JavaScript DOM shortcuts', () => {
  assert.throws(
    () => assertNativeSourceContract('withTitle: "Undo" window.find() document.querySelector("main")'),
    /Missing native contract entry|Forbidden native contract entry/,
  )
})

test('compiled menu contract checks real user-visible command labels', () => {
  const selectors = 'arrangeInFront: actualSize: copy: cut: findNext: findPrevious: paste: performClose: performMiniaturize: performZoom: reloadPage: selectAll: showFind: toggleFullScreen: zoomIn: zoomOut:'
  const runner = () => ({ error: undefined, status: 0, stdout: selectors, stderr: '' })
  assert.doesNotThrow(() => assertCompiledMenuContract('/fixture/app', runner))
  const missingRunner = () => ({ error: undefined, status: 0, stdout: 'performClose:', stderr: '' })
  assert.throws(() => assertCompiledMenuContract('/fixture/app', missingRunner), /missing responder-chain selector: arrangeInFront/)
})

test('startup presentation contract rejects WebKit or JavaScript animation runtime', () => {
  const valid = `
    let loading = "正在启动"
    let failure = "无法打开"
    let retry = "重试"
    Bundle.main.url(forResource: "DeepSeekGlyph", withExtension: "svg")
    image.isTemplate = true
    imageView.contentTintColor = .labelColor
    NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    CABasicAnimation(keyPath: "opacity")
    CABasicAnimation(keyPath: "transform.scale")
    CABasicAnimation(keyPath: "transform.translation.x")
    let lightBeamLayer = CALayer()
    override func viewDidAppear() { startLoadingAnimations() }
    override func viewWillDisappear() { stopLoadingAnimations() }
    func stopLoadingAnimations() { layer.removeAllAnimations() }
  `
  assert.doesNotThrow(() => assertStartupPresentationContract(valid))
  assert.throws(() => assertStartupPresentationContract(`${valid}\nlet view = WKWebView()`), /startup WKWebView/)
  assert.throws(() => assertStartupPresentationContract(`${valid}\ngsap.to(icon)`), /JavaScript animation runtime/)
  assert.throws(() => assertStartupPresentationContract(`${valid}\nNSApplication.shared.applicationIconImage`), /system application icon tile/)
  assert.throws(() => assertStartupPresentationContract(`${valid}\nlet halo = CALayer()`), /startup halo/)
})

test('Info.plist contract permits loopback transport without broad network or media grants', () => {
  const metadata = {
    CFBundleIdentifier: 'ai.deepseek.harness.desktop',
    CFBundleExecutable: 'DeepSeek Harness Desktop',
    CFBundleIconFile: 'AppIcon.icns',
    CFBundlePackageType: 'APPL',
    LSMinimumSystemVersion: '13.0',
    NSHighResolutionCapable: true,
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
  }
  const runner = () => ({ error: undefined, status: 0, stdout: JSON.stringify(metadata), stderr: '' })
  assert.deepEqual(readSafeInfoPlist('/fixture/Info.plist', runner), metadata)

  const broadRunner = () => ({
    error: undefined,
    status: 0,
    stdout: JSON.stringify({
      ...metadata,
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true, NSAllowsArbitraryLoadsInWebContent: true },
    }),
    stderr: '',
  })
  assert.throws(() => readSafeInfoPlist('/fixture/Info.plist', broadRunner), /NSAllowsArbitraryLoadsInWebContent/)

  const cameraRunner = () => ({
    error: undefined,
    status: 0,
    stdout: JSON.stringify({ ...metadata, NSCameraUsageDescription: 'Unexpected capability' }),
    stderr: '',
  })
  assert.throws(() => readSafeInfoPlist('/fixture/Info.plist', cameraRunner), /NSCameraUsageDescription/)
})
