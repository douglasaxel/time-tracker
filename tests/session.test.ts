import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine as TestEngine } from 'claude-code/testing'

const at = (h: number, m: number, day = 18) => new Date(2026, 9, day, h, m).getTime()
const MIN = 60_000

/** The engine beneath the plugin: clock, store, status line and session nouns, all simulated. */
function world(on: On, start: number, store: Record<string, unknown> = {}, isEnvMocked = true) {
  const clock = mock.clock(on, { now: start })
  const statuses: (string | undefined)[] = []
  const session = { id: 'sess-1', root: 'C:/work/room/app-a' }
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } })
  on('store.delete', (_, e) => { delete store[e.key]; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('ui.status', (_, e) => { statuses.push(e.text); return { value: undefined } })
  on('session.root', () => ({ value: session.root }))
  on('session.id', () => ({ value: session.id }))
  on('settings.read', () => ({ value: {} }))
  if (isEnvMocked) on('env.get', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.Stop', () => ({}))
  return { clock, statuses, session, store, status: () => statuses.at(-1) }
}

const startSession = ($: TestEngine) => $.session.start({ cwd: 'C:/work/room/app-a', surface: 'terminal', isInteractive: true })

/** One interaction: a prompt, a turn of `minutes` with a step at each edge, the turn's end. */
async function interact($: TestEngine, w: ReturnType<typeof world>, turnId: string, minutes: number) {
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'go', turnId })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'm', messageCount: 1 })) { /* drain */ }
  await w.clock.advance(minutes * MIN)
  for await (const _ of $.turn.step({ turnId, index: 1, model: 'm', messageCount: 3 })) { /* drain */ }
  await $.turn.complete({ answer: 'ok', durationMs: minutes * MIN, isAborted: false, turnId, reason: 'answer' })
}

test('a short pause between interactions counts as time worked', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0))
  await startSession($)
  expect(w.status()).toBe('⏱ 0h 00min hoje · app-a')
  await interact($, w, 't1', 5)
  await w.clock.advance(7 * MIN)
  await interact($, w, 't2', 8)
  await w.clock.advance(MIN)
  expect(w.status()).toBe('⏱ 0h 20min hoje · app-a')
})

test('a gap longer than the idle limit does not count', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0))
  await startSession($)
  await interact($, w, 't1', 5)
  await w.clock.advance(15 * MIN)
  await interact($, w, 't2', 5)
  await w.clock.advance(MIN)
  expect(w.status()).toBe('⏱ 0h 10min hoje · app-a')
})

test('the idle limit comes from the options', { options: { language: 'pt', idleMinutes: 20 } }, async ($, on) => {
  const w = world(on, at(9, 0))
  await startSession($)
  await interact($, w, 't1', 5)
  await w.clock.advance(15 * MIN)
  await interact($, w, 't2', 5)
  await w.clock.advance(MIN)
  expect(w.status()).toBe('⏱ 0h 25min hoje · app-a')
})

test('a long turn counts while Claude answers, and the status line moves each minute', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0))
  await startSession($)
  await $.prompt.submit({ text: 'build it', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'build it', turnId: 't1' })
  await w.clock.advance(15 * MIN)
  expect(w.status()).toBe('⏱ 0h 15min hoje · app-a')
  await w.clock.advance(15 * MIN)
  await $.turn.complete({ answer: 'done', durationMs: 30 * MIN, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(w.status()).toBe('⏱ 0h 30min hoje · app-a')
})

test('activity across midnight is split between the two days', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(23, 50))
  await startSession($)
  await interact($, w, 't1', 20)
  await w.clock.advance(MIN)
  expect(w.status()).toBe('⏱ 0h 10min hoje · app-a')
})

test('the session writes only its own key, each minute of activity and at the end', { options: { language: 'pt' } }, async ($, on) => {
  const other = { days: { '2026-10-18': { 'C:/work/room/app-b': [[at(8, 0), at(8, 30)]] } } }
  const w = world(on, at(9, 0), { 'session:sess-0': other })
  await startSession($)
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await w.clock.advance(MIN)
  expect(w.store['session:sess-1']).toBeDefined()
  await w.clock.advance(4 * MIN)
  await $.turn.complete({ answer: 'ok', durationMs: 5 * MIN, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sess-1', resume: { id: 'sess-1' } })
  expect(Object.keys(w.store).sort()).toEqual(['session:sess-0', 'session:sess-1'])
  expect(w.store['session:sess-0']).toEqual(other)

  // The same session started again (a resume) reads its time back through the plugin.
  await startSession($)
  expect(w.status()).toBe('⏱ 0h 05min hoje · app-a')
})

test('after /clear the new session starts its own key', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0))
  await startSession($)
  await interact($, w, 't1', 5)
  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
  w.session.id = 'sess-2'
  await interact($, w, 't2', 3)
  await w.clock.advance(MIN)
  expect(Object.keys(w.store).sort()).toEqual(['session:sess-1', 'session:sess-2'])
  // The day is the union of both sessions: 09:00-09:05 and 09:05-09:08.
  expect(w.status()).toBe('⏱ 0h 08min hoje · app-a')
})

test('the status line speaks the chosen language', { options: { language: 'en' } }, async ($, on) => {
  const w = world(on, at(9, 0))
  await startSession($)
  await interact($, w, 't1', 61)
  expect(w.status()).toBe('⏱ 1h 01min today · app-a')
})

test('auto language follows the system locale', async ($, on) => {
  mock.env(on, { LANG: 'pt_BR.UTF-8' })
  const w = world(on, at(9, 0), {}, false)
  await startSession($)
  expect(w.status()).toBe('⏱ 0h 00min hoje · app-a')
})

const day = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Another session's key, as that session would have written it: `[project folder, start, end]` stretches. */
const other = (...stretches: [string, number, number][]) => {
  const days: Record<string, Record<string, [number, number][]>> = {}
  for (const [p, s, e] of stretches) ((days[day(s)] ??= {})[`C:/work/room/${p}`] ??= []).push([s, e])
  return { days }
}

for (const [name, from, to, shown] of [
  ['partial overlap', at(9, 0), at(9, 20), '0h 30min'],
  ['total overlap', at(9, 0), at(10, 0), '1h 00min'],
  ['no overlap', at(8, 0), at(8, 30), '0h 50min'],
] as const) {
  test(`two sessions in the same project count the period once: ${name}`, { options: { language: 'pt' } }, async ($, on) => {
    const w = world(on, at(9, 10), { 'session:sess-0': other(['app-a', from, to]) })
    await startSession($)
    await interact($, w, 't1', 20)
    expect(w.status()).toBe(`⏱ ${shown} hoje · app-a`)
  })
}

test('sessions in different projects at the same time count for each project', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0), { 'session:sess-0': other(['app-b', at(9, 0), at(9, 20)]) })
  await startSession($)
  await interact($, w, 't1', 20)
  expect(w.status()).toBe('⏱ 0h 20min hoje · app-a')
  w.session.root = 'C:/work/room/app-b'
  await w.clock.advance(12 * MIN)
  expect(w.status()).toBe('⏱ 0h 20min hoje · app-b')
})

const yesterday = (h: number, m: number) => at(h, m, 17)

test('closed days become one total per project and day, and old session keys go', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0), {
    'session:sess-0': other(['app-a', yesterday(10, 0), yesterday(11, 0)], ['app-b', yesterday(14, 0), yesterday(14, 30)]),
    'session:sess-x': other(['app-a', yesterday(10, 30), yesterday(11, 30)]),
    // Ran past midnight and still holds today: its key stays, its closed day is compacted.
    'session:sess-y': other(['app-a', yesterday(23, 0), at(0, 0)], ['app-a', at(0, 0), at(0, 15)]),
  })
  await startSession($)
  expect(w.store['day:2026-10-17']).toEqual({ 'C:/work/room/app-a': 150 * MIN, 'C:/work/room/app-b': 30 * MIN })
  expect(Object.keys(w.store).sort()).toEqual(['day:2026-10-17', 'session:sess-y'])
  expect(w.status()).toBe('⏱ 0h 15min hoje · app-a')
})

test('a day is not closed until the idle limit has passed after midnight', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(0, 5), { 'session:sess-0': other(['app-a', yesterday(23, 50), at(0, 0)]) })
  await startSession($)
  expect(Object.keys(w.store)).toEqual(['session:sess-0'])
  await w.clock.advance(10 * MIN)
  expect(Object.keys(w.store).sort()).toEqual(['day:2026-10-17', 'session:sess-1'])
})

test('compacting again, or by two sessions at once, keeps the same total', { options: { language: 'pt' } }, async ($, on) => {
  // Another session already wrote the day's total but has not removed the keys yet; one key came back later.
  const w = world(on, at(9, 0), {
    'day:2026-10-17': { 'C:/work/room/app-a': 90 * MIN },
    'session:sess-x': other(['app-a', yesterday(10, 30), yesterday(11, 30)]),
  })
  await startSession($)
  await w.clock.advance(MIN)
  expect(w.store).toEqual({ 'day:2026-10-17': { 'C:/work/room/app-a': 90 * MIN }, 'session:sess-1': { days: {} } })
})

test('background work keeps the session active, and the idle limit runs from its end', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0))
  await startSession($)
  await interact($, w, 't1', 1)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'b1', type: 'subagent', status: 'running', description: 'review' }] })
  await w.clock.advance(30 * MIN)
  expect(w.status()).toBe('⏱ 0h 31min hoje · app-a')

  // The task ends and wakes the session; its turn ends with nothing left in background.
  await $.prompt.submit({ text: 'done', wait: false, origin: { kind: 'task-notification' } })
  await $.turn.start({ text: 'done', turnId: 't2' })
  await $.turn.complete({ answer: 'ok', durationMs: 0, isAborted: false, turnId: 't2', reason: 'answer' })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await w.clock.advance(9 * MIN)
  await interact($, w, 't3', 1)
  expect(w.status()).toBe('⏱ 0h 41min hoje · app-a')
  await w.clock.advance(15 * MIN)
  expect(w.status()).toBe('⏱ 0h 41min hoje · app-a')
})
