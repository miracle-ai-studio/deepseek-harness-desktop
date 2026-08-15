import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { repositoryRoot } from '../../scripts/lib/contracts.mjs'

const websiteRoot = join(repositoryRoot, 'website')

test('product website exposes the release download and bilingual content', async () => {
  const [html, css, script] = await Promise.all([
    readFile(join(websiteRoot, 'index.html'), 'utf8'),
    readFile(join(websiteRoot, 'styles.css'), 'utf8'),
    readFile(join(websiteRoot, 'site.js'), 'utf8'),
  ])

  assert.match(html, /data-release-asset="DeepSeek-Harness-Desktop\.dmg"/)
  assert.match(html, /data-download/)
  assert.match(html, /data-zh=/)
  assert.match(html, /data-en=/)
  assert.match(html, /@deepseek-ai\/dsh-macos-surface/)
  assert.match(html, /完整 DSH，<em>原生在 Mac。<\/em>/)
  assert.match(html, /原生窗口。完整 DSH。仍是同一个运行时。/)
  assert.equal((html.match(/data-hyperframe="/g) ?? []).length, 3)
  assert.equal((html.match(/data-frame-target="/g) ?? []).length, 3)
  assert.match(html, /SYSTEM[\s\S]*USER[\s\S]*CONTEXT[\s\S]*ASSISTANT[\s\S]*TOOL/)
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /@media \(max-width: 760px\)/)
  assert.match(script, /releases\/latest\/download/)
  assert.match(script, /setInterval\(\(\) => showFrame/)
  assert.doesNotMatch(html, /fonts\.googleapis|unpkg|jsdelivr/)
})

test('GitHub Pages workflow deploys only the static website directory', async () => {
  const workflow = await readFile(join(repositoryRoot, '.github/workflows/pages.yml'), 'utf8')
  assert.match(workflow, /actions\/configure-pages@v5/)
  assert.match(workflow, /actions\/upload-pages-artifact@v4/)
  assert.match(workflow, /actions\/deploy-pages@v4/)
  assert.match(workflow, /path: website/)
})

test('shipped profile opens the application from the standard Applications directory', async () => {
  const patch = await readFile(join(repositoryRoot, 'packages/cordis-plugin/cordis.patch.yml'), 'utf8')
  assert.match(patch, /DSH_DESKTOP_APP_PATH \?\? '\/Applications\/DeepSeek Harness Desktop\.app'/)
})
