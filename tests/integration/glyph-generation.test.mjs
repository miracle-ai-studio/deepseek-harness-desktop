import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertSafeMonochromeGlyph, renderMonochromeGlyph } from '../../scripts/generate-app-icon.mjs'

test('official SVG derivation removes background tiles and normalizes every path fill', () => {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">
    <rect width="50" height="50" fill="#ffffff"/>
    <path d="M1 2 L3 4" fill="#4D6BFE" fill-rule="nonzero"/>
  </svg>`
  const output = renderMonochromeGlyph(source)
  assert.match(output, /viewBox="0 0 50 50"/)
  assert.match(output, /<path d="M1 2 L3 4" fill="#000000" fill-rule="nonzero"\/>/)
  assert.doesNotMatch(output, /<rect|#ffffff|#4D6BFE/i)
  assert.doesNotThrow(() => assertSafeMonochromeGlyph(output))
})

test('startup glyph validator rejects colored paths and background elements', () => {
  assert.throws(
    () => assertSafeMonochromeGlyph('<svg><path d="M0 0" fill="#4D6BFE"/></svg>'),
    /monochrome #000000 fill/,
  )
  assert.throws(
    () => assertSafeMonochromeGlyph('<svg><rect/><path d="M0 0" fill="#000000"/></svg>'),
    /background tile/,
  )
})
