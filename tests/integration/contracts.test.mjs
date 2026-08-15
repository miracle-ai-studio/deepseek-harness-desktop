import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import {
  APP_ICON_FILENAME,
  BUNDLE_IDENTIFIER,
  PRODUCT_NAME,
  STARTUP_GLYPH_FILENAME,
  assembleApplication,
  parseArguments,
  repositoryRoot,
  resolveHarnessRoot,
} from '../../scripts/lib/contracts.mjs'

async function createHarness(root) {
  for (const marker of ['apps/cli/src/bin.ts', 'packages/bundle/web-app/package.json']) {
    const path = join(root, marker)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '', 'utf8')
  }
}

test('Harness resolution honors the explicit environment path', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop paths with spaces-'))
  const explicit = join(fixture, 'explicit harness')
  const sibling = join(fixture, 'deepseek-harness')
  await createHarness(explicit)
  await createHarness(sibling)

  const resolved = await resolveHarnessRoot({ env: { DSH_HARNESS_ROOT: explicit }, projectRoot: join(fixture, 'desktop') })
  assert.equal(resolved, explicit)
})

test('Harness resolution falls back to the sibling checkout', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop sibling-'))
  const sibling = join(fixture, 'deepseek-harness')
  await createHarness(sibling)

  const resolved = await resolveHarnessRoot({ env: {}, projectRoot: join(fixture, 'desktop') })
  assert.equal(resolved, sibling)
})

test('Harness resolution reports missing markers', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop missing-'))
  await assert.rejects(
    resolveHarnessRoot({ env: { DSH_HARNESS_ROOT: fixture }, projectRoot: fixture }),
    /apps\/cli\/src\/bin\.ts.*packages\/bundle\/web-app\/package\.json/,
  )
})

test('argument parsing rejects unknown and missing values', () => {
  const spec = {
    '--output': { kind: 'value', name: 'output' },
    '--skip-build': { kind: 'flag', name: 'skipBuild' },
  }
  assert.deepEqual(parseArguments(['--output', 'path with spaces', '--skip-build'], spec), {
    output: 'path with spaces',
    skipBuild: true,
  })
  assert.throws(() => parseArguments(['--output'], spec), /Missing value/)
  assert.throws(() => parseArguments(['--other'], spec), /Unknown argument/)
})

test('application assembly produces the contracted bundle metadata and executable', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop assembly with spaces-'))
  const executable = join(fixture, 'DeepSeekHarnessDesktop')
  const output = join(fixture, 'output with spaces', `${PRODUCT_NAME}.app`)
  const swiftBinDirectory = join(fixture, 'swift bin')
  const resourceBundle = join(swiftBinDirectory, 'Desktop_Core.bundle')
  const resourceDirectory = join(fixture, 'resources')
  await writeFile(executable, '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(executable, 0o755)
  await mkdir(resourceBundle, { recursive: true })
  await writeFile(join(resourceBundle, 'resource.txt'), 'resource', 'utf8')
  await mkdir(resourceDirectory)
  await writeFile(join(resourceDirectory, APP_ICON_FILENAME), 'fixture icon', 'utf8')
  await writeFile(join(resourceDirectory, STARTUP_GLYPH_FILENAME), '<svg><path d="M0 0" fill="#000000"/></svg>\n', 'utf8')

  assert.equal(await assembleApplication({ executablePath: executable, outputPath: output, resourceDirectory, swiftBinDirectory }), output)
  const bundledExecutable = join(output, 'Contents', 'MacOS', PRODUCT_NAME)
  assert.equal((await stat(bundledExecutable)).mode & 0o111, 0o111)
  const plist = await readFile(join(output, 'Contents', 'Info.plist'), 'utf8')
  assert.match(plist, new RegExp(`<string>${BUNDLE_IDENTIFIER}</string>`))
  assert.match(plist, new RegExp(`<string>${APP_ICON_FILENAME}</string>`))
  assert.equal(await readFile(join(output, 'Contents', 'Resources', APP_ICON_FILENAME), 'utf8'), 'fixture icon')
  assert.match(await readFile(join(output, 'Contents', 'Resources', STARTUP_GLYPH_FILENAME), 'utf8'), /#000000/)
  assert.equal(await readFile(join(output, 'Contents', 'Resources', 'Desktop_Core.bundle', 'resource.txt'), 'utf8'), 'resource')
})

test('consumer assembly copies the embedded runtime under application resources', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop runtime assembly-'))
  const executable = join(fixture, 'DeepSeekHarnessDesktop')
  const output = join(fixture, `${PRODUCT_NAME}.app`)
  const resources = join(fixture, 'resources')
  const runtime = join(fixture, 'runtime')
  await writeFile(executable, '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(executable, 0o755)
  await mkdir(resources)
  await writeFile(join(resources, APP_ICON_FILENAME), 'fixture icon', 'utf8')
  await writeFile(join(resources, STARTUP_GLYPH_FILENAME), '<svg><path d="M0 0" fill="#000000"/></svg>\n', 'utf8')
  await mkdir(runtime)
  await writeFile(join(runtime, 'manifest.json'), '{"formatVersion":1}\n', 'utf8')

  await assembleApplication({ executablePath: executable, outputPath: output, resourceDirectory: resources, runtimeDirectory: runtime })
  assert.equal(
    await readFile(join(output, 'Contents', 'Resources', 'runtime', 'manifest.json'), 'utf8'),
    '{"formatVersion":1}\n',
  )
})

test('application assembly rejects broad, non-app, and symbolic-link outputs without deleting them', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop unsafe output-'))
  const executable = join(fixture, 'DeepSeekHarnessDesktop')
  await writeFile(executable, '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(executable, 0o755)

  const nonAppDirectory = join(fixture, 'keep-this-directory')
  await mkdir(nonAppDirectory)
  await writeFile(join(nonAppDirectory, 'marker'), 'preserved', 'utf8')
  await assert.rejects(
    assembleApplication({ executablePath: executable, outputPath: nonAppDirectory }),
    /must end with \.app/,
  )
  assert.equal(await readFile(join(nonAppDirectory, 'marker'), 'utf8'), 'preserved')

  await assert.rejects(
    assembleApplication({ executablePath: executable, outputPath: repositoryRoot }),
    /project root, or a project ancestor/,
  )
  await assert.rejects(
    assembleApplication({ executablePath: executable, outputPath: '/' }),
    /filesystem root/,
  )

  const realDirectory = join(fixture, 'real app directory')
  const linkedApp = join(fixture, 'linked.app')
  await mkdir(realDirectory)
  await writeFile(join(realDirectory, 'marker'), 'preserved', 'utf8')
  await symlink(realDirectory, linkedApp)
  await assert.rejects(
    assembleApplication({ executablePath: executable, outputPath: linkedApp }),
    /must not be a symbolic link/,
  )
  assert.equal(await readFile(join(realDirectory, 'marker'), 'utf8'), 'preserved')

  const fileApp = join(fixture, 'existing-file.app')
  await writeFile(fileApp, 'preserved', 'utf8')
  await assert.rejects(
    assembleApplication({ executablePath: executable, outputPath: fileApp }),
    /already exists and is not a directory/,
  )
  assert.equal(await readFile(fileApp, 'utf8'), 'preserved')

  const stagedApp = join(fixture, 'staged.app')
  const stagingLink = join(fixture, `.staged.app.staging-${process.pid}`)
  await symlink(realDirectory, stagingLink)
  await assert.rejects(
    assembleApplication({ executablePath: executable, outputPath: stagedApp }),
    /Application staging output must not be a symbolic link/,
  )
  assert.equal(await readFile(join(realDirectory, 'marker'), 'utf8'), 'preserved')
})

test('application assembly rejects a missing icon before replacing an existing app', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop missing icon-'))
  const executable = join(fixture, 'DeepSeekHarnessDesktop')
  const output = join(fixture, `${PRODUCT_NAME}.app`)
  const resources = join(fixture, 'resources')
  await writeFile(executable, '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(executable, 0o755)
  await mkdir(resources)
  await mkdir(output)
  await writeFile(join(output, 'marker'), 'preserved', 'utf8')

  await assert.rejects(
    assembleApplication({ executablePath: executable, outputPath: output, resourceDirectory: resources }),
    /Application icon is missing/,
  )
  assert.equal(await readFile(join(output, 'marker'), 'utf8'), 'preserved')
})

test('application assembly rejects a missing startup glyph before replacing an existing app', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop missing glyph-'))
  const executable = join(fixture, 'DeepSeekHarnessDesktop')
  const output = join(fixture, `${PRODUCT_NAME}.app`)
  const resources = join(fixture, 'resources')
  await writeFile(executable, '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(executable, 0o755)
  await mkdir(resources)
  await writeFile(join(resources, APP_ICON_FILENAME), 'fixture icon', 'utf8')
  await mkdir(output)
  await writeFile(join(output, 'marker'), 'preserved', 'utf8')

  await assert.rejects(
    assembleApplication({ executablePath: executable, outputPath: output, resourceDirectory: resources }),
    /Startup glyph is missing/,
  )
  assert.equal(await readFile(join(output, 'marker'), 'utf8'), 'preserved')
})

test('upstream tool runner preserves arguments and exit status through paths with spaces', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop upstream with spaces-'))
  const harness = join(fixture, 'harness with spaces')
  await createHarness(harness)
  const executable = join(harness, 'node_modules', '.bin', 'tsc')
  await mkdir(dirname(executable), { recursive: true })
  await writeFile(executable, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 7\n', 'utf8')
  await chmod(executable, 0o755)

  const runner = join(repositoryRoot, 'scripts', 'run-upstream-bin.mjs')
  const result = spawnSync(process.execPath, [runner, 'tsc', '--project', 'path with spaces/tsconfig.json'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HARNESS_ROOT: harness },
  })
  assert.equal(result.status, 7)
  assert.equal(result.stdout, '--project\npath with spaces/tsconfig.json\n')

  const rejected = spawnSync(process.execPath, [runner, 'node'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HARNESS_ROOT: harness },
  })
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /Unsupported upstream tool node/)
})
