import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { APP_ICON_FILENAME, BUNDLE_IDENTIFIER, PRODUCT_NAME, STARTUP_GLYPH_FILENAME } from '../../scripts/lib/contracts.mjs'

const smokeScript = resolve(import.meta.dirname, '../../scripts/smoke.mjs')

async function writeFixture(root) {
  const pluginRoot = join(root, 'packages/cordis-plugin')
  await mkdir(pluginRoot, { recursive: true })
  await writeFile(join(pluginRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-macos-surface',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }), 'utf8')
  await writeFile(join(pluginRoot, 'cordis.patch.yml'), 'plugins:\n  web-app: {}\n  @deepseek-ai/dsh-macos-surface: {}\n', 'utf8')

  const appRoot = join(root, 'dist', `${PRODUCT_NAME}.app`)
  const executable = join(appRoot, 'Contents', 'MacOS', PRODUCT_NAME)
  await mkdir(dirname(executable), { recursive: true })
  await writeFile(executable, '#!/bin/sh\necho "invalid loopback URL" >&2\nexit 2\n', 'utf8')
  await chmod(executable, 0o755)
  await writeFile(
    join(appRoot, 'Contents', 'Info.plist'),
    `<plist><dict>
      <key>CFBundleExecutable</key><string>${PRODUCT_NAME}</string>
      <key>CFBundleIconFile</key><string>${APP_ICON_FILENAME}</string>
      <key>CFBundleIdentifier</key><string>${BUNDLE_IDENTIFIER}</string>
      <key>CFBundlePackageType</key><string>APPL</string>
      <key>LSMinimumSystemVersion</key><string>13.0</string>
      <key>NSHighResolutionCapable</key><true/>
      <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
    </dict></plist>`,
    'utf8',
  )
  await mkdir(join(appRoot, 'Contents', 'Resources'), { recursive: true })
  await writeFile(join(appRoot, 'Contents', 'Resources', APP_ICON_FILENAME), 'fixture icon', 'utf8')
  await writeFile(
    join(appRoot, 'Contents', 'Resources', STARTUP_GLYPH_FILENAME),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0" fill="#000000"/></svg>\n',
    'utf8',
  )
}

test('keyless smoke accepts canonical metadata and CLI rejection', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop smoke with spaces-'))
  await writeFixture(fixture)
  const result = spawnSync(process.execPath, [smokeScript, '--project-root', fixture, '--skip-native-contract'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /smoke: ok/)
})

test('keyless smoke rejects a non-executable application artifact', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop smoke invalid-'))
  await writeFixture(fixture)
  await chmod(join(fixture, 'dist', `${PRODUCT_NAME}.app`, 'Contents', 'MacOS', PRODUCT_NAME), 0o644)
  const result = spawnSync(process.execPath, [smokeScript, '--project-root', fixture, '--skip-native-contract'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /not executable/)
})

test('keyless smoke rejects broad App Transport Security configuration', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop smoke unsafe plist-'))
  await writeFixture(fixture)
  const plistPath = join(fixture, 'dist', `${PRODUCT_NAME}.app`, 'Contents', 'Info.plist')
  await writeFile(
    plistPath,
    `<plist><dict>
      <key>CFBundleExecutable</key><string>${PRODUCT_NAME}</string>
      <key>CFBundleIconFile</key><string>${APP_ICON_FILENAME}</string>
      <key>CFBundleIdentifier</key><string>${BUNDLE_IDENTIFIER}</string>
      <key>CFBundlePackageType</key><string>APPL</string>
      <key>LSMinimumSystemVersion</key><string>13.0</string>
      <key>NSHighResolutionCapable</key><true/>
      <key>NSAppTransportSecurity</key><dict>
        <key>NSAllowsLocalNetworking</key><true/>
        <key>NSAllowsArbitraryLoads</key><true/>
      </dict>
    </dict></plist>`,
    'utf8',
  )
  const result = spawnSync(process.execPath, [smokeScript, '--project-root', fixture, '--skip-native-contract'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /must not enable NSAllowsArbitraryLoads/)
})

test('keyless smoke rejects a colored or tiled startup glyph', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop smoke unsafe glyph-'))
  await writeFixture(fixture)
  const glyphPath = join(fixture, 'dist', `${PRODUCT_NAME}.app`, 'Contents', 'Resources', STARTUP_GLYPH_FILENAME)
  await writeFile(glyphPath, '<svg><rect fill="#ffffff"/><path d="M0 0" fill="#4D6BFE"/></svg>\n', 'utf8')
  const result = spawnSync(process.execPath, [smokeScript, '--project-root', fixture, '--skip-native-contract'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /must not contain a background tile/)
})
