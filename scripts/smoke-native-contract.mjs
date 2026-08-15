#!/usr/bin/env node
import { join, resolve } from 'node:path'
import { PRODUCT_NAME, parseArguments, repositoryRoot } from './lib/contracts.mjs'
import {
  assertCompiledMenuContract,
  assertNativeSourceContract,
  readSafeInfoPlist,
  readSwiftSourceCorpus,
} from './lib/native-contract.mjs'

const specification = {
  '--app': { kind: 'value', name: 'app' },
  '--project-root': { kind: 'value', name: 'projectRoot' },
  '--source-root': { kind: 'value', name: 'sourceRoot' },
}

async function main() {
  const options = parseArguments(process.argv.slice(2), specification)
  const projectRoot = resolve(options.projectRoot ?? repositoryRoot)
  const sourceRoot = resolve(options.sourceRoot ?? projectRoot)
  const appPath = resolve(options.app ?? join(projectRoot, 'dist', `${PRODUCT_NAME}.app`))
  const executablePath = join(appPath, 'Contents', 'MacOS', PRODUCT_NAME)
  const source = await readSwiftSourceCorpus(join(sourceRoot, 'apps', 'macos', 'Sources'))
  assertNativeSourceContract(source)
  readSafeInfoPlist(join(appPath, 'Contents', 'Info.plist'))
  assertCompiledMenuContract(executablePath)
  process.stdout.write(`native source: ${join(sourceRoot, 'apps', 'macos', 'Sources')}\napplication: ${appPath}\nnative contract smoke: ok\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
