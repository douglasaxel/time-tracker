// Engine wiring and every `$` call (the loader follows `$` only within this file).
// The time model is in time.ts, the status text in status.ts. The mod only observes:
// every hook passes `next(e)` on unchanged.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, Timer } from 'claude-code'
import type { Correction, Corrections, DayTotals, SessionMeasurement, SessionRecord } from '../types'
import { monthOf, monthRange, shiftMonth } from './calendar'
import { applyCorrections, isSameTarget, nextCorrection, parseMinutes } from './corrections'
import { isPortuguese, strings, type Lang } from './i18n'
import { correctionsKey, dayOfKey, isClosedDayKey, isCorrectionsKey, isEffortKey, isLedgerKey, ledger, merge, mergeAgents, sessionKey } from './ledger'
import { markdownTable } from './markdown'
import { panel, sessionModes } from './panel'
import { statusText } from './status'
import { MIN, dayKey, expire, liveAgentDays, liveDays, period, startManualPause, syncAgents, touch, type Moment } from './time'
import { buildTree, commonFolder, dayEfforts, dayTotals, folderDays, inPeriod, projectTotals, toSlashes } from './tree'

const empty: SessionMeasurement = { id: null, days: {}, live: null, turns: [], agents: {}, liveAgents: {} }
const measurementAtom = atom({ plugin: 'time-tracker', key: 'measurement' } as const, empty)
/** When the last classic.Stop listed background work of the session; null when it listed none. */
const backgroundSinceAtom = atom({ plugin: 'time-tracker', key: 'backgroundSince' } as const, null)
/** Manual pause, per session in $.state (survives hot reloads): while on, activity records nothing. */
const pausedAtom = atom({ plugin: 'time-tracker', key: 'paused' } as const, false)
/** Every session's corrections: the `fix:<day>` keys, read at each sync. */
const correctionsAtom = atom({ plugin: 'time-tracker', key: 'corrections' } as const, {} as Corrections)
// The /horas panel's state.
const collapsedAtom = atom({ plugin: 'time-tracker', key: 'collapsed' } as const, [])
const filterAtom = atom({ plugin: 'time-tracker', key: 'filter' } as const, 'week')
const statusLineAtom = atom({ plugin: 'time-tracker', key: 'statusLine' } as const, '')
const viewAtom = atom({ plugin: 'time-tracker', key: 'view' } as const, 'days')
const measureAtom = atom({ plugin: 'time-tracker', key: 'measure' } as const, 'real')
const offsetAtom = atom({ plugin: 'time-tracker', key: 'offset' } as const, 0)
const correctionsOpenAtom = atom({ plugin: 'time-tracker', key: 'correctionsOpen' } as const, false)
const pickerAtom = atom({ plugin: 'time-tracker', key: 'picker' } as const, null)
const customRangeAtom = atom({ plugin: 'time-tracker', key: 'customRange' } as const, null)
const selectedAtom = atom({ plugin: 'time-tracker', key: 'selected' } as const, null)
const correctingAtom = atom({ plugin: 'time-tracker', key: 'correcting' } as const, null)
const copyAtom = atom({ plugin: 'time-tracker', key: 'copy' } as const, null)

const PANE = 'time-tracker'

// Module variables reset on every load; register, session.start and sync set them again.
let inactivityMs = 10 * MIN
let lang: Lang = 'en'
let lastSaved = ''
let timer: Timer | undefined
/** The other sessions' records, read from the store when a session id binds and each minute. */
let others: readonly unknown[] = []
/** The closed days' totals, as `sync` last saw them. */
let closed: Record<string, DayTotals> = {}
/** The closed days' time with subagents counted, as `sync` last saw it. */
let closedEfforts: Record<string, DayTotals> = {}

const quiet = (p: Promise<unknown>) => p.catch(() => undefined)

/** What a session's key holds; a session that ran no subagent writes only its days. */
function sessionRecord(m: SessionMeasurement): SessionRecord {
  const agents = liveAgentDays(m)
  return { days: liveDays(m), ...(Object.keys(agents).length ? { agents } : {}) }
}

/** Time worked per day and project, every session counted once, before corrections. */
const measuredDays = (m: SessionMeasurement) => dayTotals(merge([sessionRecord(m), ...others]), closed)

/** The time with each subagent counted, per day and project, before corrections. */
function measuredEfforts(m: SessionMeasurement) {
  const sessions = [sessionRecord(m), ...others]
  return dayEfforts(measuredDays(m), merge(sessions), mergeAgents(sessions), closedEfforts)
}

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
 * The project: the git repository the session is working in now (its main working tree for a
 * worktree), or the session's project root outside any repository. Re-read at every activity edge
 * and minute: neither a shell `cd` nor a /cd raises an event. Kept per folder, as finding the
 * repository reads the working copy.
 */
async function project($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  const known = projectOf.get(cwd)
  if (known) return known
  const repo = await $.session.repo().catch(() => null)
  const p = toSlashes(repo?.root ?? (await $.session.root()))
  projectOf.set(cwd, p)
  return p
}

const momentNow = async ($: EngineInterface): Promise<Moment> => ({ now: await $.clock.now(), project: await project($), inactivityMs })

/** Binds the measurement to the current session id, picking up what that session already stored. */
async function ensureSession($: EngineInterface) {
  if ((await read($, measurementAtom)).id) return
  const id = await $.session.id()
  const stored = (await $.store.get(sessionKey(id))) as SessionRecord | undefined
  const m = await update($, measurementAtom, r => (r.id ? r : { ...empty, id, days: stored?.days ?? {}, agents: stored?.agents ?? {} }))
  await quiet(sync($, m, await $.clock.now()))
}

async function persist($: EngineInterface, m: SessionMeasurement) {
  if (!m.id) return
  const value = sessionRecord(m)
  const json = JSON.stringify(value)
  if (json === lastSaved) return
  await $.store.set(sessionKey(m.id), value)
  lastSaved = json
}

/** Today's time in the project the session is in, as the panel shows it: every session, corrections applied. */
async function showStatus($: EngineInterface, m: SessionMeasurement, now: number) {
  const p = m.live?.project ?? (await project($))
  const today = applyCorrections(measuredDays(m), await read($, correctionsAtom))[dayKey(now)]?.[p] ?? 0
  const text = statusText(today, p, lang, await read($, pausedAtom))
  await update($, statusLineAtom, () => text)
  // The desktop draws it as a button among the mode labels under the prompt, so the plain line would repeat it.
  $.ui.status((await $.session.surfaces()).includes('desktop') ? undefined : text)
}

/** An active instant now: a prompt, a step's start or end, a turn's start or end. */
async function activity($: EngineInterface, edge: { turnStart?: string; turnEnd?: string } = {}) {
  await ensureSession($)
  const at = await momentNow($)
  const paused = await read($, pausedAtom)
  const m = await update($, measurementAtom, r => {
    const turns = r.turns.filter(t => t !== edge.turnEnd)
    if (edge.turnStart && !turns.includes(edge.turnStart)) turns.push(edge.turnStart)
    return paused ? { ...r, turns } : syncAgents({ ...touch(r, at), turns }, at.now, at.project)
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
    return busy ? syncAgents(touch(r, at), now, at.project) : expire(r, now, inactivityMs)
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
  if (own) entries[own] = sessionRecord(m)
  const plan = ledger(entries, own, dayKey(now - inactivityMs - MIN))
  for (const [k, v] of plan.set) await $.store.set(k, v)
  for (const k of plan.remove) await $.store.delete(k)
  others = plan.others
  const saved = Object.entries({ ...entries, ...Object.fromEntries(plan.set) })
  const byDay = (isKey: (k: string) => boolean) => Object.fromEntries(saved.filter(([k]) => isKey(k)).map(([k, v]) => [dayOfKey(k), v]))
  closed = byDay(isClosedDayKey) as Record<string, DayTotals>
  closedEfforts = byDay(isEffortKey) as Record<string, DayTotals>
  await update($, correctionsAtom, () => byDay(isCorrectionsKey) as Corrections)
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

/** Opens the panel, or closes it when it is up; true when it ends up open. */
async function togglePane($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: strings[lang].pane })
  return true
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
      await persist($, syncAgents({ ...m, turns: [] }, await $.clock.now(), ''))
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
  on('command.run', { command: 'horas' }, async $ => ({ text: (await togglePane($)) ? strings[lang].opened : strings[lang].closed }))

  // Under the prompt, the desktop lets a plugin draw the mode labels, not the hint line.
  // The terminal keeps its own footer and the plain status line.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const status = await read($, statusLineAtom)
    if (e.surface !== 'desktop' || !status) return next(e)
    return sessionModes($.ui.resolve(e), e.props.modes, status, () => quiet(togglePane($)))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // The days in the chosen period, measured plus corrections, and the selected folder's days among them.
    const m = await read($, measurementAtom)
    const filter = await read($, filterAtom)
    const corrections = await read($, correctionsAtom)
    const offset = await read($, offsetAtom)
    const now = await $.clock.now()
    const today = dayKey(now)
    const customRange = await read($, customRangeAtom)
    const range = filter === 'custom' && customRange ? customRange : period(filter, now, offset)
    const allDays = applyCorrections(measuredDays(m), corrections)
    const days = inPeriod(allDays, range)
    const efforts = applyCorrections(measuredEfforts(m), corrections)
    const measure = await read($, measureAtom)
    const picker = await read($, pickerAtom)
    const selected = await read($, selectedAtom)
    const totals = projectTotals(measure === 'effort' ? inPeriod(efforts, range) : days)
    // The selected folder, or the deepest one holding every project: what names the rows and the table.
    const folder = selected ?? commonFolder(Object.keys(totals))
    const shown = folderDays(days, folder, corrections, efforts)
    const clearCopy = () => update($, copyAtom, () => null)
    const openPicker = () => update($, pickerAtom, p => (p ? null : { month: monthOf(range[1] < today ? range[1] : today), start: null }))
    const applyRange = (r: [string, string]) =>
      Promise.all([update($, customRangeAtom, () => r), update($, filterAtom, () => 'custom'), update($, pickerAtom, () => null), clearCopy()])
    return panel($.ui.resolve(e), {
      roots: buildTree(totals),
      surface: e.surface,
      columns: e.props.bodyColumns || 40,
      view: await read($, viewAtom),
      measure,
      onMeasure: next => update($, measureAtom, () => next),
      onView: v => update($, viewAtom, () => v),
      collapsed: await read($, collapsedAtom),
      lang,
      onToggle: path => update($, collapsedAtom, c => (c.includes(path) ? c.filter(p => p !== path) : [...c, path])),
      paused: await read($, pausedAtom),
      onPause: () => quiet(togglePause($)),
      filter,
      selected,
      folder,
      days: shown,
      onFilter: f =>
        f === 'custom'
          ? openPicker()
          : Promise.all([update($, filterAtom, () => f), update($, offsetAtom, () => 0), update($, pickerAtom, () => null), clearCopy()]),
      picker,
      today,
      workedDays: new Set(Object.entries(allDays).filter(([, ps]) => Object.values(ps).some(ms => ms > 0)).map(([d]) => d)),
      onOpenPicker: openPicker,
      onPickerMonth: delta => update($, pickerAtom, p => p && { ...p, month: shiftMonth(p.month, delta) }),
      // The first press starts the period; a later day (or the start again) ends it; an earlier day starts it again.
      onPickDay: day =>
        picker?.start && day >= picker.start ? applyRange([picker.start, day]) : update($, pickerAtom, p => p && { ...p, start: day }),
      onPickMonth: () => (picker ? applyRange(monthRange(picker.month)) : undefined),
      range,
      offset,
      onOffset: n => Promise.all([update($, offsetAtom, () => Math.min(0, n)), clearCopy()]),
      correctionsOpen: await read($, correctionsOpenAtom),
      onCorrectionsOpen: () => update($, correctionsOpenAtom, o => !o),
      onSelect: path =>
        Promise.all([update($, selectedAtom, () => path), update($, viewAtom, () => 'days'), clearCopy()]),
      onClearSelection: () => Promise.all([update($, selectedAtom, () => null), clearCopy()]),
      correcting: await read($, correctingAtom),
      onCorrect: target => update($, correctingAtom, t => (isSameTarget(t, target) ? null : target)),
      onAdjust: text => quiet(correct($, parseMinutes(text))),
      onDelete: () => quiet(correct($, 'delete')),
      copy: await read($, copyAtom),
      onCopy: surface => quiet(copyTable($, markdownTable(folder, shown, filter, range, lang), surface)),
    })
  })
}
