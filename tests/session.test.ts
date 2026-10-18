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
  const files: Record<string, string> = {}
  on('session.root', () => ({ value: session.root }))
  on('fs.read', (_, e) => {
    const text = files[e.path.replace(/\\/g, '/')]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
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
  return { clock, statuses, session, store, files, status: () => statuses.at(-1) }
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
  expect(w.status()).toBe('⏱ 0h 03min hoje · app-a')
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

test('after a /cd the new time goes to the new folder and the earlier time stays in the old one', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0))
  await startSession($)
  await interact($, w, 't1', 5)
  await w.clock.advance(2 * MIN)
  w.session.root = 'C:/work/room/app-b'
  await interact($, w, 't2', 4)
  await w.clock.advance(MIN)
  expect(w.status()).toBe('⏱ 0h 04min hoje · app-b')
  w.session.root = 'C:/work/room/app-a'
  await $.prompt.submit({ text: 'back', wait: false, origin: { kind: 'composer' } })
  expect(w.status()).toBe('⏱ 0h 07min hoje · app-a')
})

test('a /cd while Claude answers moves the time on the next minute', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0))
  await startSession($)
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await w.clock.advance(3 * MIN)
  w.session.root = 'C:/work/room/app-b'
  await w.clock.advance(2 * MIN)
  await $.turn.complete({ answer: 'ok', durationMs: 5 * MIN, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(w.status()).toBe('⏱ 0h 01min hoje · app-b')
  w.session.root = 'C:/work/room/app-a'
  await $.prompt.submit({ text: 'back', wait: false, origin: { kind: 'composer' } })
  expect(w.status()).toBe('⏱ 0h 04min hoje · app-a')
})

test('a session in a worktree records its time in the main repository', { options: { language: 'pt' } }, async ($, on) => {
  const w = world(on, at(9, 0))
  w.session.root = 'C:\\work\\room\\app-a\\.claude\\worktrees\\wt'
  w.files['C:/work/room/app-a/.claude/worktrees/wt/.git'] = 'gitdir: C:/work/room/app-a/.git/worktrees/wt\n'
  await startSession($)
  await interact($, w, 't1', 5)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sess-1', resume: { id: 'sess-1' } })
  expect(w.status()).toBe('⏱ 0h 05min hoje · app-a')
  expect(w.store['session:sess-1']).toEqual({ days: { '2026-10-18': { 'C:/work/room/app-a': [[at(9, 0), at(9, 5)]] } } })
})
