import assert from 'node:assert/strict'
import test from 'node:test'
import { navigationLayer, routeTrail } from './navigation.js'

test('a game trail moves through the library, menu, and level selector', () => {
  assert.deepEqual(routeTrail('/'), ['/'])
  assert.deepEqual(routeTrail('/games/sudoku'), ['/', '/games/sudoku'])
  assert.deepEqual(routeTrail('/games/sudoku/'), ['/', '/games/sudoku'])
  assert.deepEqual(routeTrail('/games/sudoku/how-to'), ['/', '/games/sudoku', '/games/sudoku/how-to'])
  assert.deepEqual(routeTrail('/games/sudoku/history'), ['/', '/games/sudoku', '/games/sudoku/history'])
  assert.deepEqual(routeTrail('/games/sudoku/packs/budgies/1'),
    ['/', '/games/sudoku', '/games/sudoku/packs/budgies/1'])
})

test('sections and Studio screens return to their entry layer', () => {
  assert.deepEqual(routeTrail('/news'), ['/', '/news'])
  assert.deepEqual(routeTrail('/about'), ['/', '/about'])
  assert.deepEqual(routeTrail('/admin'), ['/', '/admin'])
  assert.deepEqual(routeTrail('/studio'), ['/', '/studio'])
  assert.deepEqual(routeTrail('/studio/nonograms'), ['/', '/studio', '/studio/nonograms'])
  assert.deepEqual(routeTrail('/studio/packs'), ['/', '/studio', '/studio/packs'])
  assert.deepEqual(routeTrail('/studio/nonograms/admin'), ['/', '/admin', '/studio/nonograms/admin'])
})

test('history markers only accept a valid layer depth', () => {
  assert.equal(navigationLayer(undefined), undefined)
  assert.equal(navigationLayer(null), undefined)
  assert.equal(navigationLayer({ aviarium: {} }), undefined)
  assert.equal(navigationLayer({ aviarium: { depth: -1 } }), undefined)
  assert.equal(navigationLayer({ aviarium: { depth: 1.5 } }), undefined)
  assert.deepEqual(navigationLayer({ aviarium: { depth: 2 } }), { depth: 2 })
  assert.deepEqual(navigationLayer({ aviarium: { depth: 3, player: true } }), { depth: 3, player: true })
  assert.deepEqual(navigationLayer({ aviarium: { depth: 4, studio: 'pack', studioPack: 'draft-1' } }),
    { depth: 4, studio: 'pack', studioPack: 'draft-1' })
  assert.deepEqual(navigationLayer({ aviarium: { depth: 5, studio: 'trial' } }), { depth: 5, studio: 'trial' })
  assert.deepEqual(navigationLayer({ aviarium: { depth: 6, studio: 'other', studioPack: 'draft-1' } }), { depth: 6 })
  assert.deepEqual(navigationLayer({ other: true }), undefined)
})
