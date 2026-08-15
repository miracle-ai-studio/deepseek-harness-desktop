#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { parseArguments, repositoryRoot, resolveHarnessRoot } from './lib/contracts.mjs'
import { scrubRuntimeText } from './lib/runtime-hygiene.mjs'

const NODE_VERSION = '24.19.0'
const NODE_ARCHIVE = `node-v${NODE_VERSION}-darwin-x64.tar.xz`
const NODE_ARCHIVE_SHA256 = 'd35e95230f46f6f0751df497c56622c6735e05d5e1fb1630996a005b9d328fe4'
const NODE_ARCHIVE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}`
const RUNTIME_PACKAGE_NAME = '@deepseek-ai/dsh-desktop-runtime'
const HOST_ENTRY = 'host/node_modules/@deepseek-ai/dsh/lib/bin.js'
const WEB_FRONTEND = 'host/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html'
const NODE_ENTRY = 'node/bin/node'

const specification = {
  '--output': { kind: 'value', name: 'output' },
  '--harness-root': { kind: 'value', name: 'harnessRoot' },
  '--keep-workspace': { kind: 'flag', name: 'keepWorkspace' },
}

function sanitize(text, sensitiveRoots) {
  let result = text
  for (const root of sensitiveRoots) {
    if (root) result = result.replaceAll(root, '<local-path>')
  }
  return result
    .replaceAll(/\/Users\/[^/\s]+\/[\w./@+~=:-]+/g, '<local-path>')
    .replaceAll(/\/(?:private\/)?(?:var\/folders|tmp)\/[\w./@+~=:-]+/g, '<temporary-path>')
}

async function run(command, args, options = {}) {
  const sensitiveRoots = options.sensitiveRoots ?? []
  await new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', chunk => process.stdout.write(sanitize(chunk.toString(), sensitiveRoots)))
    child.stderr.on('data', chunk => process.stderr.write(sanitize(chunk.toString(), sensitiveRoots)))
    child.once('error', () => reject(new Error(`Unable to run ${basename(command)}.`)))
    child.once('exit', (code, signal) => {
      if (code === 0) accept()
      else reject(new Error(`${basename(command)} failed (${code === null ? `signal ${String(signal)}` : `exit ${String(code)}`}).`))
    })
  })
}

async function copyOnWrite(source, destination, sensitiveRoots) {
  try {
    await run('/bin/cp', ['-cR', source, destination], { sensitiveRoots })
  } catch {
    await cp(source, destination, { recursive: true })
  }
}

async function sha256(path) {
  const hash = createHash('sha256')
  await new Promise((accept, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', accept)
  })
  return hash.digest('hex')
}

async function collectWorkspacePackages(root) {
  const manifests = []
  const addChildren = async (parent, depth) => {
    const entries = await readdir(join(root, parent), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const child = join(parent, entry.name)
      if (depth === 1) {
        const manifestPath = join(root, child, 'package.json')
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
        if (manifest.name) manifests.push({ path: child, manifest })
      } else {
        await addChildren(child, depth - 1)
      }
    }
  }
  await addChildren('vendor', 1)
  await addChildren('packages', 2)
  await addChildren('apps', 1)
  await addChildren('native/landlock-run/packages', 1)
  const landlockManifest = join(root, 'native/landlock-run/package.json')
  try {
    const manifest = JSON.parse(await readFile(landlockManifest, 'utf8'))
    if (manifest.name) manifests.push({ path: 'native/landlock-run', manifest })
  } catch {}
  return new Map(manifests.map(entry => [entry.manifest.name, entry]))
}

function productionWorkspaceClosure(packages) {
  const roots = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-web-frontend']
  const closure = new Set()
  const queue = [...roots]
  for (let index = 0; index < queue.length; index += 1) {
    const name = queue[index]
    if (closure.has(name)) continue
    const entry = packages.get(name)
    if (!entry) throw new Error(`Required Harness package is unavailable: ${name}`)
    closure.add(name)
    const manifest = entry.manifest
    const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies }
    for (const dependency of Object.keys(dependencies)) {
      if (packages.has(dependency) && !closure.has(dependency)) queue.push(dependency)
    }
    for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (manifest.peerDependenciesMeta?.[peer]?.optional === true) continue
      if (packages.has(peer) && !closure.has(peer)) queue.push(peer)
      if (packages.has(peer) && typeof range !== 'string') throw new Error(`Invalid peer dependency for ${name}.`)
    }
  }
  return [...closure].sort()
}

async function findSymlink(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested) return nested
    }
  }
}

async function materializeLinks(staging) {
  const nodeModules = join(staging, 'node_modules')
  for (let link = await findSymlink(nodeModules); link !== undefined; link = await findSymlink(nodeModules)) {
    const segments = link.slice(nodeModules.length + 1).split(sep)
    const bin = segments.lastIndexOf('.bin')
    if (bin >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, bin + 1)), { recursive: true, force: true })
      continue
    }
    const source = await realpath(link)
    await rm(link, { recursive: true, force: true })
    await cp(source, link, {
      recursive: true,
      dereference: true,
      filter: path => path !== join(source, 'node_modules') && !path.startsWith(join(source, 'node_modules') + sep),
    })
  }
}

async function restoreLegacyHoists(staging, deployRoot) {
  const deployed = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8'))
  for (const dependency of Object.keys(deployed.dependencies ?? {})) {
    const destination = join(staging, 'node_modules', dependency)
    try {
      await access(destination)
      continue
    } catch {}
    const source = join(deployRoot, 'node_modules', dependency)
    await access(source).catch(() => { throw new Error(`Production dependency was omitted: ${dependency}`) })
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== join(source, 'node_modules') && !path.startsWith(join(source, 'node_modules') + sep),
    })
  }
}

async function stageHost(harnessRoot, output, temporaryRoot) {
  const workspace = join(temporaryRoot, 'workspace')
  const sensitiveRoots = [harnessRoot, workspace, temporaryRoot, repositoryRoot]
  process.stdout.write('Preparing isolated Harness workspace…\n')
  await run('git', ['clone', '--local', '--no-hardlinks', '--quiet', harnessRoot, workspace], { sensitiveRoots })
  await copyOnWrite(join(harnessRoot, 'node_modules'), join(workspace, 'node_modules'), sensitiveRoots)

  process.stdout.write('Restoring isolated workspace links…\n')
  await run('corepack', ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts', '--offline'], {
    cwd: workspace,
    sensitiveRoots,
    env: { ...process.env, CI: 'true' },
  })

  process.stdout.write('Building Harness production packages…\n')
  await run('npm', ['run', 'build:lib'], {
    cwd: workspace,
    sensitiveRoots,
    env: { ...process.env, CI: 'true' },
  })
  await run('corepack', ['pnpm', '--config.verify-deps-before-run=false', '--filter', '@deepseek-ai/dsh-web-frontend', 'run', 'build'], {
    cwd: workspace,
    sensitiveRoots,
    env: { ...process.env, CI: 'true' },
  })

  const packages = await collectWorkspacePackages(workspace)
  const dependencies = Object.fromEntries(productionWorkspaceClosure(packages).map(name => [name, 'workspace:^']))
  const deployRoot = join(workspace, 'apps/desktop-runtime')
  await mkdir(deployRoot, { recursive: true })
  await writeFile(join(deployRoot, 'package.json'), `${JSON.stringify({
    name: RUNTIME_PACKAGE_NAME,
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies,
  }, null, 2)}\n`)
  await run('corepack', ['pnpm', 'install', '--no-frozen-lockfile', '--ignore-scripts', '--offline'], {
    cwd: workspace,
    sensitiveRoots,
    env: { ...process.env, CI: 'true' },
  })

  const hostOutput = join(output, 'host')
  process.stdout.write(`Staging ${Object.keys(dependencies).length} Harness workspace packages…\n`)
  await run('corepack', [
    'pnpm', '--config.verify-deps-before-run=false', '--filter', RUNTIME_PACKAGE_NAME,
    'deploy', '--legacy', '--prod', '--config.node-linker=hoisted',
    '--config.auto-install-peers=false', '--config.link-workspace-packages=true', hostOutput,
  ], {
    cwd: workspace,
    sensitiveRoots,
    env: { ...process.env, CI: 'true' },
  })
  await restoreLegacyHoists(hostOutput, deployRoot)
  await materializeLinks(hostOutput)
  await rm(join(hostOutput, 'node_modules/.modules.yaml'), { force: true })
  await scrubRuntimeText(hostOutput, [workspace, temporaryRoot, harnessRoot, repositoryRoot])
}

async function stageNode(output, temporaryRoot) {
  const archivePath = join(temporaryRoot, NODE_ARCHIVE)
  process.stdout.write(`Downloading official Node.js ${NODE_VERSION} runtime…\n`)
  await run('curl', ['--fail', '--location', '--silent', '--show-error', NODE_ARCHIVE_URL, '--output', archivePath], {
    sensitiveRoots: [temporaryRoot, repositoryRoot],
  })
  if (await sha256(archivePath) !== NODE_ARCHIVE_SHA256) throw new Error('Official Node.js archive checksum mismatch.')
  const extracted = join(temporaryRoot, 'node-extracted')
  await mkdir(extracted)
  await run('tar', ['-xJf', archivePath, '-C', extracted], { sensitiveRoots: [temporaryRoot, repositoryRoot] })
  const source = join(extracted, NODE_ARCHIVE.replace(/\.tar\.xz$/, ''))
  const nodeOutput = join(output, 'node')
  await mkdir(join(nodeOutput, 'bin'), { recursive: true })
  await cp(join(source, 'bin/node'), join(nodeOutput, 'bin/node'))
  await chmod(join(nodeOutput, 'bin/node'), 0o755)
  await cp(join(source, 'LICENSE'), join(nodeOutput, 'LICENSE'))
}

async function assertRuntime(output) {
  for (const relativePath of [NODE_ENTRY, HOST_ENTRY, WEB_FRONTEND]) {
    const info = await stat(join(output, relativePath)).catch(() => undefined)
    if (!info?.isFile()) throw new Error(`Runtime entry is missing: ${relativePath}`)
  }
  const link = await findSymlink(output)
  if (link) throw new Error(`Runtime contains an unresolved symbolic link: ${relative(output, link)}`)
}

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'x64') {
    throw new Error('This release recipe currently requires an x64 macOS build host.')
  }
  const options = parseArguments(process.argv.slice(2), specification)
  const harnessRoot = await resolveHarnessRoot({
    env: options.harnessRoot ? { ...process.env, DSH_HARNESS_ROOT: options.harnessRoot } : process.env,
  })
  const output = resolve(options.output ?? join(repositoryRoot, 'dist/runtime'))
  if (output === '/' || output === repositoryRoot || !output.startsWith(join(repositoryRoot, 'dist') + sep)) {
    throw new Error('Runtime output must be a dedicated directory under dist.')
  }
  const staging = `${output}.staging-${process.pid}`
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-desktop-runtime-'))
  try {
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    await stageHost(harnessRoot, staging, temporaryRoot)
    await stageNode(staging, temporaryRoot)
    await assertRuntime(staging)
    const harnessPackage = JSON.parse(await readFile(join(harnessRoot, 'apps/cli/package.json'), 'utf8'))
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify({
      formatVersion: 1,
      architecture: 'x86_64',
      nodeVersion: NODE_VERSION,
      nodeArchiveSha256: NODE_ARCHIVE_SHA256,
      harnessVersion: harnessPackage.version,
      nodeExecutable: NODE_ENTRY,
      hostEntry: HOST_ENTRY,
      webFrontend: WEB_FRONTEND,
    }, null, 2)}\n`)
    await rm(output, { recursive: true, force: true })
    await mkdir(dirname(output), { recursive: true })
    await rename(staging, output)
    process.stdout.write('Embedded runtime staged successfully.\n')
  } finally {
    if (!options.keepWorkspace) await rm(temporaryRoot, { recursive: true, force: true })
  }
}

main().catch(error => {
  process.stderr.write(`${sanitize(error instanceof Error ? error.message : String(error), [repositoryRoot])}\n`)
  process.exitCode = 1
})
