// Engine wiring and every `$` call (the loader follows `$` only within this file).
// The time model is in time.ts, the status text in status.ts. The mod only observes:
// every hook passes `next(e)` on unchanged.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { DayTotals, Days, Rec, SessionRecord } from '../types'
import { isPortuguese, strings, type Lang } from './i18n'
import { panel } from './panel'
import { statusText } from './status'
import { ledger, sessionKey } from './ledger'
import { MIN, dayKey, expire, pause, period, touch, withLive } from './time'
import { buildTree, dayTotals, folderDays, inPeriod, projectTotals } from './tree'

const empty: Rec = { id: null, days: {}, live: null, turns: [] }
const recAtom = atom({ plugin: 'time-tracker', key: 'rec' } as const, empty)
const PANE = 'time-tracker' // the /horas panel (#3)

// Module variables reset on every load; register and session.start set them again.
let idleMs = 10 * MIN
let lang: Lang = 'en'
let lastSaved = ''
let timer: Timer | undefined

const quiet = (p: Promise<unknown>) => p.catch(() => undefined)

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

// --- #6 project: /cd and worktree ---
const slash = (p: string) => {
  const s = p.trim().replace(/\\/g, '/')
  return s.length > 3 ? s.replace(/\/+$/, '') : s
}
const projectOf = new Map<string, string>()

/**
 * The project: the session's project root, re-read at every activity edge and minute (a /cd
 * moves it, with no event), or the main repository when that root is a worktree, as its `.git`
 * file's `gitdir: <main>/.git/worktrees/<name>` says. `/` separators, no trailing one.
 */
async function project($: EngineInterface): Promise<string> {
  const root = slash(await $.session.root())
  const known = projectOf.get(root)
  if (known) return known
  // ponytail: an absolute gitdir only; a relative one (worktree.useRelativePaths) counts for the worktree.
  const git = await $.fs.read(`${root}/.git`).catch(() => '')
  const main = typeof git === 'string' ? /^gitdir:\s*(.+?)\/\.git\/worktrees\/[^/]+\s*$/m.exec(slash(git))?.[1] : undefined
  const p = main && /^([a-z]:)?\//i.test(main) ? slash(main) : root
  projectOf.set(root, p)
  return p
}
// --- end #6 ---

/** Binds the record to the current session id, picking up what that session already stored. */
async function ensureSession($: EngineInterface) {
  if ((await read($, recAtom)).id) return
  const id = await $.session.id()
  const stored = (await $.store.get(sessionKey(id))) as SessionRecord | undefined
  const rec = await update($, recAtom, r => (r.id ? r : { ...empty, id, days: stored?.days ?? {} }))
  await quiet(sync($, rec, await $.clock.now()))
}

async function persist($: EngineInterface, rec: Rec) {
  if (!rec.id) return
  const value: SessionRecord = { days: withLive(rec.days, rec.live) }
  const json = JSON.stringify(value)
  if (json === lastSaved) return
  await $.store.set(sessionKey(rec.id), value)
  lastSaved = json
}

async function showStatus($: EngineInterface, rec: Rec, now: number) {
  $.ui.status(statusText(rec, now, rec.live?.project ?? (await project($)), lang, others, await read($, pausedAtom)))
}

/** An active instant now: a prompt, a step's start or end, a turn's start or end. */
async function activity($: EngineInterface, edge: { turnStart?: string; turnEnd?: string } = {}) {
  await ensureSession($)
  const now = await $.clock.now()
  const p = await project($)
  const paused = await read($, pausedAtom)
  const rec = await update($, recAtom, r => {
    const turns = r.turns.filter(t => t !== edge.turnEnd)
    if (edge.turnStart && !turns.includes(edge.turnStart)) turns.push(edge.turnStart)
    return { ...(paused ? r : touch(r, now, p, idleMs)), turns }
  })
  await showStatus($, rec, now)
}

/** Each minute: a running turn keeps the session active; otherwise the idle limit may end the activity. */
async function tick($: EngineInterface) {
  const now = await $.clock.now()
  const busy = (await read($, recAtom)).turns.length > 0 || (await read($, bgAtom))
  const p = busy ? await project($) : ''
  const paused = await read($, pausedAtom)
  const rec = await update($, recAtom, r => (paused ? r : busy ? touch(r, now, p, idleMs) : expire(r, now, idleMs)))
  await persist($, rec)
  await quiet(sync($, rec, now))
  await showStatus($, rec, now)
}

// ---- #4: sessions in parallel and compaction (logic in ledger.ts) ----
/** The other sessions' days, read from the store when a session id binds and each minute. */
let others: Days = {}
/** The closed days' totals, as `sync` last saw them (read by the /horas panel, #3). */
let closed: Record<string, DayTotals> = {}

/** Reads every session and closed-day key, compacts the closed days, and refreshes `others`. */
async function sync($: EngineInterface, rec: Rec, now: number) {
  const entries: Record<string, unknown> = {}
  for (const k of await $.store.keys()) if (/^(session|day):/.test(k)) entries[k] = await $.store.get(k)
  const own = rec.id ? sessionKey(rec.id) : ''
  if (own) entries[own] = { days: withLive(rec.days, rec.live) }
  const plan = ledger(entries, own, dayKey(now - idleMs - MIN))
  for (const [k, v] of plan.set) await $.store.set(k, v)
  for (const k of plan.remove) await $.store.delete(k)
  others = plan.others
  const days = [...Object.entries(entries).filter(([k]) => k.startsWith('day:')), ...plan.set]
  closed = Object.fromEntries(days.map(([k, v]) => [k.slice('day:'.length), v as DayTotals]))
}
// ---- end #4 ----

// --- #7 background work: while any background task of the session runs, the session counts as active.
// classic.Stop lists the work still in flight at each main-turn end; when a task ends it wakes the
// session (a task-notification prompt), so the next Stop lists what is left.
const bgAtom = atom({ plugin: 'time-tracker', key: 'background' } as const, false)
// --- end #7

// --- #8 manual pause: per session in $.state (survives hot reloads); while on, activity records nothing.
const pausedAtom = atom({ plugin: 'time-tracker', key: 'paused' } as const, false)

/** Pause closes the activity in progress at this moment; Resume lets the next activity count. */
async function togglePause($: EngineInterface) {
  await ensureSession($)
  const now = await $.clock.now()
  const p = await project($)
  const paused = await update($, pausedAtom, x => !x)
  const rec = paused ? await update($, recAtom, r => pause(r, now, p, idleMs)) : await read($, recAtom)
  await persist($, rec)
  await showStatus($, rec, now)
}
// --- end #8

const turnKey = (e: { turnId: string; agentId?: string }) => `${e.agentId ?? 'main'}:${e.turnId}`

export const register: Register = (on, options) => {
  idleMs = Math.max(1, Number(options.idleMinutes) || 10) * MIN

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await quiet((async () => {
      lang = await detectLang($, options.language)
      await quiet($.command.register({ name: 'horas', description: strings[lang].paneHint })) // /horas panel (#3)
      await ensureSession($)
      await showStatus($, await read($, recAtom), await $.clock.now())
    })())
    timer?.cancel()
    timer = $.clock.every(MIN, () => void quiet(tick($)))
    return r
  })

  // Close the activity, write the key, and forget the id: a /clear continues under a new one.
  on('session.end', async ($, e, next) => {
    await quiet((async () => {
      const rec = await read($, recAtom)
      await persist($, { ...rec, live: null, days: withLive(rec.days, rec.live) })
      await update($, recAtom, () => empty)
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

  // --- #7 background work
  on('classic.Stop', async ($, e, next) => {
    await quiet(update($, bgAtom, () => (e.background_tasks?.length ?? 0) > 0))
    return next(e)
  })
  // --- end #7

  // --- /horas panel (#3): the command toggles the pane; the drawing reads the record, so each tick redraws it.
  const collapsed = atom({ plugin: 'time-tracker', key: 'collapsed' } as const, [])
  const filterAtom = atom({ plugin: 'time-tracker', key: 'filter' } as const, 'all') // #5
  const selectedAtom = atom({ plugin: 'time-tracker', key: 'selected' } as const, null) // #5

  on('command.run', { command: 'horas' }, async $ => {
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: strings[lang].closed }
    }
    await $.ui.open({ id: PANE, title: strings[lang].pane })
    return { text: strings[lang].opened }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const rec = await read($, recAtom)
    // #5: the days in the chosen period, and the selected folder's days among them.
    const filter = await read($, filterAtom)
    const days = inPeriod(dayTotals(withLive(rec.days, rec.live), others, closed), period(filter, await $.clock.now()))
    const selected = await read($, selectedAtom)
    return panel($.ui.resolve(e), {
      roots: buildTree(projectTotals(days)),
      collapsed: await read($, collapsed),
      lang,
      onToggle: path => update($, collapsed, c => (c.includes(path) ? c.filter(p => p !== path) : [...c, path])),
      paused: await read($, pausedAtom),
      onPause: () => quiet(togglePause($)),
      filter,
      selected: selected ? { path: selected, days: folderDays(days, selected) } : null,
      onFilter: f => update($, filterAtom, () => f),
      onPick: path => update($, selectedAtom, s => (s === path ? null : path)),
    })
  })
  // --- end /horas panel
}
