// Engine wiring and every `$` call (the loader follows `$` only within this file).
// The time model is in time.ts, the status text in status.ts. The mod only observes:
// every hook passes `next(e)` on unchanged.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, Timer } from 'claude-code'
import type { Correction, Corrections, DayTotals, Days, SessionMeasurement, SessionRecord } from '../types'
import { applyCorrections, isSameTarget, nextCorrection, parseMinutes } from './corrections'
import { isPortuguese, strings, type Lang } from './i18n'
import { correctionsKey, dayOfKey, isClosedDayKey, isCorrectionsKey, isLedgerKey, ledger, sessionKey } from './ledger'
import { markdownTable } from './markdown'
import { panel } from './panel'
import { statusText } from './status'
import { MIN, dayKey, expire, liveDays, period, startManualPause, touch, type Moment } from './time'
import { buildTree, dayTotals, folderDays, inPeriod, projectTotals, resolvePath, toSlashes } from './tree'

const empty: SessionMeasurement = { id: null, days: {}, live: null, turns: [] }
const measurementAtom = atom({ plugin: 'time-tracker', key: 'measurement' } as const, empty)
/** When the last classic.Stop listed background work of the session; null when it listed none. */
const backgroundSinceAtom = atom({ plugin: 'time-tracker', key: 'backgroundSince' } as const, null)
/** Manual pause, per session in $.state (survives hot reloads): while on, activity records nothing. */
const pausedAtom = atom({ plugin: 'time-tracker', key: 'paused' } as const, false)
/** Every session's corrections: the `fix:<day>` keys, read at each sync. */
const correctionsAtom = atom({ plugin: 'time-tracker', key: 'corrections' } as const, {} as Corrections)
// The /horas panel's state.
const collapsedAtom = atom({ plugin: 'time-tracker', key: 'collapsed' } as const, [])
const filterAtom = atom({ plugin: 'time-tracker', key: 'filter' } as const, 'all')
const selectedAtom = atom({ plugin: 'time-tracker', key: 'selected' } as const, null)
const correctingAtom = atom({ plugin: 'time-tracker', key: 'correcting' } as const, null)
const copyAtom = atom({ plugin: 'time-tracker', key: 'copy' } as const, null)

const PANE = 'time-tracker'

// Module variables reset on every load; register, session.start and sync set them again.
let inactivityMs = 10 * MIN
let lang: Lang = 'en'
let lastSaved = ''
let timer: Timer | undefined
/** The other sessions' days, read from the store when a session id binds and each minute. */
let others: Days = {}
/** The closed days' totals, as `sync` last saw them. */
let closed: Record<string, DayTotals> = {}

const quiet = (p: Promise<unknown>) => p.catch(() => undefined)

/** Time worked per day and project, every session counted once, before corrections. */
const measuredDays = (m: SessionMeasurement) => dayTotals(liveDays(m), others, closed)

async function detectLang($: EngineInterface, option: unknown): Promise<Lang> {
  if (option === 'en' || option === 'pt') return option
  try {
    const settings = (await $.settings.read()) as Record<string, unknown>
    if (typeof settings.language === 'string' && settings.language.trim()) return isPortuguese(settings.language) ? 'pt' : 'en'
    const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
    return isPortuguese(locale) ? 'pt' : 'en'
  } catch {
    return 'en'
  }
}

const projectOf = new Map<string, string>()

/**
 * The project: the session's project root, re-read at every activity edge and minute (a /cd
 * moves it, with no event), or the original repository when that root is a worktree, as its
 * `.git` file's `gitdir: <original>/.git/worktrees/<name>` says (relative to the worktree, or
 * absolute). `/` separators, no trailing one.
 */
async function project($: EngineInterface): Promise<string> {
  const root = toSlashes(await $.session.root())
  const known = projectOf.get(root)
  if (known) return known
  const git = await $.fs.read(`${root}/.git`).catch(() => '')
  const gitdir = typeof git === 'string' ? /^gitdir:\s*(.+?)\s*$/m.exec(git)?.[1] : undefined
  const original = gitdir ? /^(.+)\/\.git\/worktrees\/[^/]+$/.exec(resolvePath(root, toSlashes(gitdir)))?.[1] : undefined
  const p = original ?? root
  projectOf.set(root, p)
  return p
}

const momentNow = async ($: EngineInterface): Promise<Moment> => ({ now: await $.clock.now(), project: await project($), inactivityMs })

/** Binds the measurement to the current session id, picking up what that session already stored. */
async function ensureSession($: EngineInterface) {
  if ((await read($, measurementAtom)).id) return
  const id = await $.session.id()
  const stored = (await $.store.get(sessionKey(id))) as SessionRecord | undefined
  const m = await update($, measurementAtom, r => (r.id ? r : { ...empty, id, days: stored?.days ?? {} }))
  await quiet(sync($, m, await $.clock.now()))
}

async function persist($: EngineInterface, m: SessionMeasurement) {
  if (!m.id) return
  const value: SessionRecord = { days: liveDays(m) }
  const json = JSON.stringify(value)
  if (json === lastSaved) return
  await $.store.set(sessionKey(m.id), value)
  lastSaved = json
}

/** Today's time in the project the session is in, as the panel shows it: every session, corrections applied. */
async function showStatus($: EngineInterface, m: SessionMeasurement, now: number) {
  const p = m.live?.project ?? (await project($))
  const today = applyCorrections(measuredDays(m), await read($, correctionsAtom))[dayKey(now)]?.[p] ?? 0
  $.ui.status(statusText(today, p, lang, await read($, pausedAtom)))
}

/** An active instant now: a prompt, a step's start or end, a turn's start or end. */
async function activity($: EngineInterface, edge: { turnStart?: string; turnEnd?: string } = {}) {
  await ensureSession($)
  const at = await momentNow($)
  const paused = await read($, pausedAtom)
  const m = await update($, measurementAtom, r => {
    const turns = r.turns.filter(t => t !== edge.turnEnd)
    if (edge.turnStart && !turns.includes(edge.turnStart)) turns.push(edge.turnStart)
    return { ...(paused ? r : touch(r, at)), turns }
  })
  await showStatus($, m, at.now)
}

/**
 * Whether background work keeps the session active: a classic.Stop listed it within the
 * inactivity limit, or a subagent of the session still runs. Otherwise the flag is cleared, so a
 * task whose end never reached a Stop does not count forever.
 */
async function isBackgroundBusy($: EngineInterface, now: number): Promise<boolean> {
  const since = await read($, backgroundSinceAtom)
  if (since === null) return false
  if (now - since <= inactivityMs) return true
  const agents = await $.agent.list().catch(() => [])
  if (agents.some(a => a.status === 'running' || a.status === 'pending')) return true
  await update($, backgroundSinceAtom, s => (s === since ? null : s))
  return false
}

/** Each minute: a running turn or background work keeps the session active; otherwise the inactivity limit may end the activity. */
async function tick($: EngineInterface) {
  const now = await $.clock.now()
  const busy = (await read($, measurementAtom)).turns.length > 0 || (await isBackgroundBusy($, now))
  const at: Moment = { now, project: busy ? await project($) : '', inactivityMs }
  const paused = await read($, pausedAtom)
  const m = await update($, measurementAtom, r => {
    if (paused) return r
    return busy ? touch(r, at) : expire(r, now, inactivityMs)
  })
  await persist($, m)
  await quiet(sync($, m, now))
  await showStatus($, m, now)
}

/** Reads every session, closed-day and correction key, compacts the closed days (ledger.ts), and refreshes `others`. */
async function sync($: EngineInterface, m: SessionMeasurement, now: number) {
  const entries: Record<string, unknown> = {}
  for (const k of await $.store.keys()) if (isLedgerKey(k)) entries[k] = await $.store.get(k)
  const own = m.id ? sessionKey(m.id) : ''
  if (own) entries[own] = { days: liveDays(m) }
  const plan = ledger(entries, own, dayKey(now - inactivityMs - MIN))
  for (const [k, v] of plan.set) await $.store.set(k, v)
  for (const k of plan.remove) await $.store.delete(k)
  others = plan.others
  const days = [...Object.entries(entries).filter(([k]) => isClosedDayKey(k)), ...plan.set]
  closed = Object.fromEntries(days.map(([k, v]) => [dayOfKey(k), v as DayTotals]))
  const corrections = Object.entries(entries).filter(([k]) => isCorrectionsKey(k))
  await update($, correctionsAtom, () => Object.fromEntries(corrections.map(([k, v]) => [dayOfKey(k), v as Record<string, Correction>])))
}

/** Pause closes the activity in progress at this moment; Resume lets the next activity count. */
async function togglePause($: EngineInterface) {
  await ensureSession($)
  const at = await momentNow($)
  const paused = await update($, pausedAtom, x => !x)
  const m = paused ? await update($, measurementAtom, r => startManualPause(r, at)) : await read($, measurementAtom)
  await persist($, m)
  await showStatus($, m, at.now)
}

/** Deletes or adjusts the open project day, re-reading its key so another session's correction stays. */
async function correct($: EngineInterface, change: number | 'delete' | undefined) {
  const target = await read($, correctingAtom)
  if (change === undefined || !target) return
  const { day, project: p } = target
  const measured = measuredDays(await read($, measurementAtom))[day]?.[p] ?? 0
  const stored = ((await $.store.get(correctionsKey(day))) ?? {}) as Record<string, Correction>
  const value = { ...stored, [p]: nextCorrection(stored[p], measured, change) }
  await $.store.set(correctionsKey(day), value)
  await update($, correctionsAtom, c => ({ ...c, [day]: value }))
  await showStatus($, await read($, measurementAtom), await $.clock.now())
}

/** Copies the table as drawn; a desktop may refuse the copy, so the outcome is always kept to show. */
async function copyTable($: EngineInterface, text: string, surface: RenderSurface) {
  const r = await $.ui.copy({ text, surface }).catch(() => ({ isCopied: false }))
  await update($, copyAtom, () => ({ ok: r.isCopied, text }))
}

const turnKey = (e: { turnId: string; agentId?: string }) => `${e.agentId ?? 'main'}:${e.turnId}`

export const register: Register = (on, options) => {
  // The userConfig key stays `idleMinutes`, as saved configs name it.
  inactivityMs = Math.max(1, Number(options.idleMinutes) || 10) * MIN

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await quiet((async () => {
      lang = await detectLang($, options.language)
      await quiet($.command.register({ name: 'horas', description: strings[lang].paneHint }))
      await ensureSession($)
      await showStatus($, await read($, measurementAtom), await $.clock.now())
    })())
    timer?.cancel()
    timer = $.clock.every(MIN, () => void quiet(tick($)))
    return r
  })

  // Close the activity, write the key, and forget the id: a /clear continues under a new one.
  on('session.end', async ($, e, next) => {
    await quiet((async () => {
      const m = await read($, measurementAtom)
      await persist($, { ...m, live: null, days: liveDays(m) })
      await update($, measurementAtom, () => empty)
      lastSaved = ''
    })())
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await quiet(activity($))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await quiet(activity($, { turnStart: turnKey(e) }))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    await quiet(activity($))
    const r = yield* next(e)
    await quiet(activity($))
    return r
  })

  on('turn.complete', async ($, e, next) => {
    await quiet(activity($, { turnEnd: turnKey(e) }))
    return next(e)
  })

  // Each main-turn end lists the background work still in flight; a task that ends wakes the
  // session (a task-notification prompt), so the next Stop lists what is left. The minute tick
  // clears a flag no Stop confirms again (isBackgroundBusy).
  on('classic.Stop', async ($, e, next) => {
    await quiet((async () => {
      const now = await $.clock.now()
      await update($, backgroundSinceAtom, () => ((e.background_tasks?.length ?? 0) > 0 ? now : null))
    })())
    return next(e)
  })

  // The /horas panel: the command toggles the pane; the drawing reads the measurement, so each tick redraws it.
  on('command.run', { command: 'horas' }, async $ => {
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: strings[lang].closed }
    }
    await $.ui.open({ id: PANE, title: strings[lang].pane })
    return { text: strings[lang].opened }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // The days in the chosen period, measured plus corrections, and the selected folder's days among them.
    const m = await read($, measurementAtom)
    const filter = await read($, filterAtom)
    const corrections = await read($, correctionsAtom)
    const range = period(filter, await $.clock.now())
    const days = inPeriod(applyCorrections(measuredDays(m), corrections), range)
    const selected = await read($, selectedAtom)
    const shown = selected ? folderDays(days, selected, corrections) : []
    const clearCopy = () => update($, copyAtom, () => null)
    return panel($.ui.resolve(e), {
      roots: buildTree(projectTotals(days)),
      collapsed: await read($, collapsedAtom),
      lang,
      onToggle: path => update($, collapsedAtom, c => (c.includes(path) ? c.filter(p => p !== path) : [...c, path])),
      paused: await read($, pausedAtom),
      onPause: () => quiet(togglePause($)),
      filter,
      selected: selected ? { path: selected, days: shown } : null,
      onFilter: f => Promise.all([update($, filterAtom, () => f), clearCopy()]),
      onSelect: path =>
        Promise.all([update($, selectedAtom, () => path), update($, collapsedAtom, c => c.filter(p => p !== path)), clearCopy()]),
      onPick: path => Promise.all([update($, selectedAtom, s => (s === path ? null : path)), clearCopy()]),
      correcting: await read($, correctingAtom),
      onCorrect: target => update($, correctingAtom, t => (isSameTarget(t, target) ? null : target)),
      onAdjust: text => quiet(correct($, parseMinutes(text))),
      onDelete: () => quiet(correct($, 'delete')),
      copy: await read($, copyAtom),
      onCopy: surface => quiet(copyTable($, selected ? markdownTable(selected, shown, filter, range, lang) : '', surface)),
    })
  })
}
