import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine as TestEngine } from 'claude-code/testing'

const at = (h: number, m: number, day = 18) => new Date(2026, 9, day, h, m).getTime()
const MIN = 60_000
const PANE = 'time-tracker'
const W = 'C:/Users/dougl/workstation'

/** The engine beneath the plugin, with panes that open and close. */
function world(on: On, start: number, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: start })
  const panes = new Set<string>()
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } })
  on('store.delete', (_, e) => { delete store[e.key]; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: '', isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', (_, e) => { panes.add(e.id); return { value: { isPlaced: true } } })
  on('ui.close', (_, e) => { panes.delete(e.id); return { value: undefined } })
  on('command.register', () => ({ value: { command: 'horas' } }))
  on('session.root', () => ({ value: `${W}/room/app-a` }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return { clock, panes }
}

/** This session's earlier time, read back on start (a resume). */
const earlier = (projects: Record<string, number>) => ({
  'session:sess-1': {
    days: { '2026-10-17': Object.fromEntries(Object.entries(projects).map(([p, min]) => [p, min ? [[at(8, 0, 17), at(8, 0, 17) + min * MIN]] : []])) },
  },
})

const startSession = ($: TestEngine) => $.session.start({ cwd: `${W}/room/app-a`, surface: 'terminal', isInteractive: true })
const horas = ($: TestEngine) => $.command.run({ command: 'horas', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

/** The tree as the person reads it: one line per folder, its name and its total. */
async function tree(ui: { findAll: (q: { type: 'Box' }) => Promise<{ key?: string; text: string }[]> }) {
  return (await ui.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('row:')).map(b => b.text.replace(/\s*(\d+h \d\dmin)$/, ' $1').trim())
}

test('/horas opens the panel and closes it', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0))
  await startSession($)
  expect((await horas($)).text).toBe('Painel de horas aberto')
  expect([...w.panes]).toEqual([PANE])
  expect((await horas($)).text).toBe('Painel de horas fechado')
  expect([...w.panes]).toEqual([])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the tree starts at the disk root, folds single-child folders and sums each folder`, { options: { language: 'pt' } }, async ($, on) => {
    world(on, at(9, 0), earlier({
      [`${W}/room/app-a`]: 60,
      [`${W}/room/app-b`]: 30,
      [`${W}/room`]: 10,
      [`${W}/personal/site`]: 15,
      [`${W}/personal/empty`]: 0,
    }))
    await startSession($)
    const ui = await $.ui.mount({ plugin: 'time-tracker', surface, component: 'Pane', requestId: PANE, props: {} as never })
    expect(await tree(ui)).toEqual([
      `▾ ${W} 1h 55min`,
      '· personal/site 0h 15min',
      '▾ room 1h 40min',
      '· app-a 1h 00min',
      '· app-b 0h 30min',
    ])
  })

  test(`${surface}: a folder collapses and expands`, { options: { language: 'en' } }, async ($, on) => {
    world(on, at(9, 0), earlier({ [`${W}/room/app-a`]: 60, [`${W}/room/app-b`]: 30, [`${W}/personal/site`]: 15 }))
    await startSession($)
    const ui = await $.ui.mount({ plugin: 'time-tracker', surface, component: 'Pane', requestId: PANE, props: {} as never })
    await ui.press({ key: `node:${W}/room` })
    expect(await tree(ui)).toEqual([`▾ ${W} 1h 45min`, '· personal/site 0h 15min', '▸ room 1h 30min'])
    await ui.press({ key: `node:${W}` })
    expect(await tree(ui)).toEqual([`▸ ${W} 1h 45min`])
    await ui.press({ key: `node:${W}` })
    await ui.press({ key: `node:${W}/room` })
    expect(await tree(ui)).toHaveLength(5)
  })

  test(`${surface}: with no time yet the panel says how time is counted`, { options: { language: 'en' } }, async ($, on) => {
    world(on, at(9, 0))
    await startSession($)
    const ui = await $.ui.mount({ plugin: 'time-tracker', surface, component: 'Pane', requestId: PANE, props: {} as never })
    expect(await tree(ui)).toEqual([])
    expect((await ui.find({ type: 'Text', text: /No time worked yet/ }))?.text).toBeDefined()
  })
}

test('the panel redraws each minute while the session is active', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0), earlier({ [`${W}/room/app-b`]: 30 }))
  await startSession($)
  const ui = await $.ui.mount({ plugin: 'time-tracker', surface: 'terminal', component: 'Pane', requestId: PANE, props: {} as never })
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await w.clock.advance(20 * MIN)
  expect(await tree(ui)).toEqual([`▾ ${W}/room 0h 50min`, '· app-a 0h 20min', '· app-b 0h 30min'])
  expect((await ui.find({ key: 'total' }))?.text).toBe('Total0h 50min')
  await w.clock.advance(MIN)
  expect(await tree(ui)).toContain('· app-a 0h 21min')
})

test('the tree counts every session once, closed days included', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0), {
    // Another session in app-a today, overlapping this one's first 10 minutes, and in app-b.
    'session:sess-0': { days: { '2026-10-18': { [`${W}/room/app-a`]: [[at(8, 50), at(9, 10)]], [`${W}/room/app-b`]: [[at(8, 0), at(8, 30)]] } } },
    // A closed day, compacted into a total per project.
    'day:2026-10-10': { [`${W}/room/app-b`]: 45 * MIN },
  })
  await startSession($)
  const ui = await $.ui.mount({ plugin: 'time-tracker', surface: 'terminal', component: 'Pane', requestId: PANE, props: {} as never })
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await w.clock.advance(21 * MIN)
  expect(await tree(ui)).toEqual([`▾ ${W}/room 1h 46min`, '· app-a 0h 31min', '· app-b 1h 15min'])
})

// ---- #5 days and filters ----
/** Time on several days: closed days as stored totals, today from another session. */
const spread = () => ({
  'day:2026-09-30': { [`${W}/room/app-a`]: 40 * MIN },
  'day:2026-10-01': { [`${W}/room/app-b`]: 30 * MIN },
  'day:2026-10-11': { [`${W}/room/app-a`]: 20 * MIN }, // the Sunday before this week
  'day:2026-10-12': { [`${W}/room/app-b`]: 15 * MIN }, // this week's Monday
  'session:sess-0': { days: { '2026-10-18': { [`${W}/room/app-a`]: [[at(8, 0), at(8, 5)]] } } }, // today, a Sunday
})

/** The selected folder's days as the person reads them: the day and its time. */
async function days(ui: { findAll: (q: { type: 'Box' }) => Promise<{ key?: string; children: unknown[] }[]> }) {
  const text = (c: unknown): string => (typeof c === 'string' ? c : ((c as { children?: unknown[] }).children ?? []).map(text).join(''))
  return (await ui.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('day:')).map(b => b.children.map(text).join(' '))
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the four filters change the tree and the totals; the week runs Monday to Sunday`, { options: { language: 'pt' } }, async ($, on) => {
    world(on, at(9, 0), spread())
    await startSession($)
    const ui = await $.ui.mount({ plugin: 'time-tracker', surface, component: 'Pane', requestId: PANE, props: {} as never })
    const total = async () => (await ui.find({ key: 'total' }))?.text
    await ui.press({ key: 'filter:today' })
    expect(await tree(ui)).toEqual([`· ${W}/room/app-a 0h 05min`])
    expect(await total()).toBe('Total0h 05min')
    await ui.press({ key: 'filter:week' })
    expect(await tree(ui)).toEqual([`▾ ${W}/room 0h 20min`, '· app-a 0h 05min', '· app-b 0h 15min'])
    await ui.press({ key: 'filter:month' })
    expect(await tree(ui)).toEqual([`▾ ${W}/room 1h 10min`, '· app-a 0h 25min', '· app-b 0h 45min'])
    await ui.press({ key: 'filter:all' })
    expect(await tree(ui)).toEqual([`▾ ${W}/room 1h 50min`, '· app-a 1h 05min', '· app-b 0h 45min'])
    expect(await total()).toBe('Total1h 50min')
  })

  test(`${surface}: selecting a folder lists its days in the period with each day's time`, { options: { language: 'pt' } }, async ($, on) => {
    world(on, at(9, 0), spread())
    await startSession($)
    const ui = await $.ui.mount({ plugin: 'time-tracker', surface, component: 'Pane', requestId: PANE, props: {} as never })
    expect(await days(ui)).toEqual([])
    await ui.press({ key: 'filter:week' })
    await ui.press({ key: `pick:${W}/room` })
    expect(await days(ui)).toEqual(['seg 12/10 0h 15min', 'dom 18/10 0h 05min'])
    await ui.press({ key: 'filter:all' })
    expect(await days(ui)).toEqual(['qua 30/09 0h 40min', 'qui 01/10 0h 30min', 'dom 11/10 0h 20min', 'seg 12/10 0h 15min', 'dom 18/10 0h 05min'])
    await ui.press({ key: `pick:${W}/room/app-b` })
    await ui.press({ key: 'filter:month' })
    expect(await days(ui)).toEqual(['qui 01/10 0h 30min', 'seg 12/10 0h 15min'])
    await ui.press({ key: `pick:${W}/room/app-b` })
    expect(await days(ui)).toEqual([])
  })
}

test('an activity from 23:50 to 0:10 counts 10 minutes on each day', { options: { language: 'en' } }, async ($, on) => {
  const w = world(on, at(23, 50, 17))
  await startSession($)
  const ui = await $.ui.mount({ plugin: 'time-tracker', surface: 'terminal', component: 'Pane', requestId: PANE, props: {} as never })
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await w.clock.advance(20 * MIN)
  await ui.press({ key: 'filter:today' })
  expect(await tree(ui)).toEqual([`· ${W}/room/app-a 0h 10min`])
  await ui.press({ key: 'filter:all' })
  await ui.press({ key: `pick:${W}/room/app-a` })
  expect(await days(ui)).toEqual(['Sat Oct 17 0h 10min', 'Sun Oct 18 0h 10min'])
})
// ---- end #5 ----
