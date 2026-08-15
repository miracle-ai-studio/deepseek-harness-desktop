#!/usr/bin/env node
import { resolve } from 'node:path'
import { parseArguments, repositoryRoot } from './lib/contracts.mjs'
import { scrubRuntimeText } from './lib/runtime-hygiene.mjs'

const specification = { '--runtime': { kind: 'value', name: 'runtime' } }
const options = parseArguments(process.argv.slice(2), specification)
const runtime = resolve(options.runtime ?? `${repositoryRoot}/dist/runtime`)
const changed = await scrubRuntimeText(runtime, [repositoryRoot, resolve(repositoryRoot, '../deepseek-harness')])
process.stdout.write(`runtime hygiene: ${changed} text files sanitized\n`)
