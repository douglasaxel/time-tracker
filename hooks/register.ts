// Engine wiring and every `$` call (the loader follows `$` only within this file).
// The time model is in time.ts, the status text in status.ts. The mod only observes:
// every hook passes `next(e)` on unchanged.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { Rec, SessionRecord } from '../types'
import { isPortuguese, strings, type Lang } from './i18n'
import { panel } from './panel'
import { statusText } from './status'
import { MIN, expire, touch, withLive } from './time'
import { buildTree, projectTotals } from './tree'

const empty: Rec = { id: null, days: {}, live: null, turns: [] }
const recAtom = atom({ plugin: 'time-tracker', key: 'rec' } as const, empty)
const PANE = 'time-tracker' // the /horas panel (#3)

/** Store layout: each session writes only its own key. */
const sessionKey = (id: string) => `session:${id}`

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

/** The project: the session's project root, with `/` separators and no trailing one. */
async function project($: EngineInterface): Promise<string> {
  const p = (await $.session.root()).replace(/\\/g, '/')
  return p.length > 3 ? p.replace(/\/+$/, '') : p
}

/** Binds the record to the current session id, picking up what that session already stored. */
async function ensureSession($: EngineInterface) {
  if ((await read($, recAtom)).id) return
  const id = await $.session.id()
  const stored = (await $.store.get(sessionKey(id))) as SessionRecord | undefined
  await update($, recAtom, r => (r.id ? r : { ...empty, id, days: stored?.days ?? {} }))
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
  $.ui.status(statusText(rec, now, rec.live?.project ?? (await project($)), lang))
}

/** An active instant now: a prompt, a step's start or end, a turn's start or end. */
async function activity($: EngineInterface, edge: { turnStart?: string; turnEnd?: string } = {}) {
  await ensureSession($)
  const now = await $.clock.now()
  const p = await project($)
  const rec = await update($, recAtom, r => {
    const turns = r.turns.filter(t => t !== edge.turnEnd)
    if (edge.turnStart && !turns.includes(edge.turnStart)) turns.push(edge.turnStart)
    return { ...touch(r, now, p, idleMs), turns }
  })
  await showStatus($, rec, now)
}

/** Each minute: a running turn keeps the session active; otherwise the idle limit may end the activity. */
async function tick($: EngineInterface) {
  const now = await $.clock.now()
  const busy = (await read($, recAtom)).turns.length > 0
  const p = busy ? await project($) : ''
  const rec = await update($, recAtom, r => (busy ? touch(r, now, p, idleMs) : expire(r, now, idleMs)))
  await persist($, rec)
  await showStatus($, rec, now)
}

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

  // --- /horas panel (#3): the command toggles the pane; the drawing reads the record, so each tick redraws it.
  const collapsed = atom({ plugin: 'time-tracker', key: 'collapsed' } as const, [])

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
    return panel($.ui.resolve(e), {
      roots: buildTree(projectTotals(withLive(rec.days, rec.live))),
      collapsed: await read($, collapsed),
      lang,
      onToggle: path => update($, collapsed, c => (c.includes(path) ? c.filter(p => p !== path) : [...c, path])),
    })
  })
  // --- end /horas panel
}
