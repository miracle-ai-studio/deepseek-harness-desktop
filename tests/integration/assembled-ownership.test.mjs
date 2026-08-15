import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertHostSurvivedAttachedApplication } from '../../scripts/smoke-assembled.mjs'

test('assembled attach evidence requires a running Host PID and reachable readiness endpoint', async () => {
  const calls = []
  const host = { pid: 42, exitCode: null, signalCode: null }
  await assertHostSurvivedAttachedApplication(
    host,
    'http://127.0.0.1:43123',
    async url => calls.push(['probe', url]),
    pid => calls.push(['pid', pid]),
  )
  assert.deepEqual(calls, [
    ['pid', 42],
    ['probe', 'http://127.0.0.1:43123'],
  ])
})

test('assembled attach evidence rejects a Host that exited with the application', async () => {
  await assert.rejects(
    assertHostSurvivedAttachedApplication(
      { pid: 42, exitCode: 0, signalCode: null },
      'http://127.0.0.1:43123',
      async () => {},
      () => {},
    ),
    /Attached application terminated its Host/,
  )
})
