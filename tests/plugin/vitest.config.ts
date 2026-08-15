import { fileURLToPath } from 'node:url'

const harnessRoot = fileURLToPath(new URL('../../../deepseek-harness/', import.meta.url))

export default {
  resolve: {
    alias: {
      '@deepseek-ai/schemastery': `${harnessRoot}vendor/schemastery/lib/index.mjs`,
    },
  },
  test: {
    include: ['tests/plugin/**/*.spec.ts'],
    testTimeout: 5_000,
  },
}
