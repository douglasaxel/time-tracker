import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine as TestEngine } from 'claude-code/testing'

const at = (h: number, m: number, day = 18) => new Date(2026, 9, day, h, m).getTime()
const MIN = 60_000
const PANE = 'time-tracker'
const A = 'C:/work/room/app-a'

/** The engine beneath the plugin: clock, store, status line, panes and session nouns. */
function world(on: On, start: number, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: start })
  const statuses: (string | undefined)[] = []
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } })
  on('store.delete', (_, e) => { delete store[e.key]; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('ui.status', (_, e) => { statuses.push(e.text); return { value: undefined } })
  on('command.register', () => ({ value: { command: 'horas' } }))
  on('session.root', () => ({ value: A }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return { clock, store, status: () => statuses.at(-1) }
}

const startSession = ($: TestEngine) => $.session.start({ cwd: A, surface: 'terminal', isInteractive: true })
const turnStart = async ($: TestEngine, turnId: string) => {
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'go', turnId })
}
const turnEnd = ($: TestEngine, turnId: string) =>
  $.turn.complete({ answer: 'ok', durationMs: 0, isAborted: false, turnId, reason: 'answer' })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: Pause stops this session's count until Resume`, { options: { language: 'pt' } }, async ($, on) => {
    const w = world(on, at(9, 0))
    await startSession($)
    const ui = await $.ui.mount({ plugin: 'time-tracker', surface, component: 'Pane', requestId: PANE, props: {} as never })
    await turnStart($, 't1')
    await w.clock.advance(10 * MIN)
    expect(w.status()).toBe('⏱ 0h 10min hoje · app-a')

    // Pausing mid-turn closes the activity there; nothing more counts, even with Claude still answering.
    await w.clock.advance(MIN / 2)
    await ui.press({ key: 'pause' })
    expect(w.status()).toBe('⏸ 0h 10min hoje · app-a')
    expect((await ui.find({ type: 'Text', text: /Em pausa/ }))?.text).toBeDefined()
    await w.clock.advance(20 * MIN)
    await turnEnd($, 't1')
    await turnStart($, 't2')
    await w.clock.advance(5 * MIN)
    expect(w.status()).toBe('⏸ 0h 10min hoje · app-a')
    expect((await ui.find({ key: 'total' }))?.text).toBe('Total0h 10min')

    // Resume: the next interactions count again.
    await ui.press({ key: 'pause' })
    expect(w.status()).toBe('⏱ 0h 10min hoje · app-a')
    expect(await ui.find({ type: 'Text', text: /Em pausa/ })).toBeUndefined()
    await turnEnd($, 't2')
    await turnStart($, 't3')
    await w.clock.advance(5 * MIN)
    expect(w.status()).toBe('⏱ 0h 15min hoje · app-a')
    expect((await ui.find({ key: 'total' }))?.text).toBe('Total0h 15min')
  })
}

test('the control reads Pausar while counting and Retomar while paused', { options: { language: 'pt' } }, async ($, on) => {
  world(on, at(9, 0))
  await startSession($)
  const ui = await $.ui.mount({ plugin: 'time-tracker', surface: 'terminal', component: 'Pane', requestId: PANE, props: {} as never })
  expect((await ui.find({ key: 'pause' }))?.text).toMatch(/Pausar/)
  await ui.press({ key: 'pause' })
  expect((await ui.find({ key: 'pause' }))?.text).toMatch(/Retomar/)
})

test('other sessions keep counting while this one is paused', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0))
  await startSession($)
  const ui = await $.ui.mount({ plugin: 'time-tracker', surface: 'terminal', component: 'Pane', requestId: PANE, props: {} as never })
  await turnStart($, 't1')
  await w.clock.advance(5 * MIN)
  await ui.press({ key: 'pause' })
  // Another session in another project works 09:05-09:25 and writes its key.
  w.store['session:sess-0'] = { days: { '2026-10-18': { 'C:/work/room/app-b': [[at(9, 5), at(9, 25)]] } } }
  await w.clock.advance(20 * MIN)
  expect(w.status()).toBe('⏸ 0h 05min hoje · app-a')
  expect((await ui.find({ key: 'total' }))?.text).toBe('Total0h 25min')
})
