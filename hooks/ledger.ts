// The store across sessions: the union of every session's key, and the compaction of closed days. Pure.
import type { DayTotals, Days, SessionRecord } from '../types'
import { total, union } from './time'

/**
 * Store layout, every key the mod writes: each session writes only its own `session:<id>` while it
 * runs; a closed day is one `day:<YYYY-MM-DD>` holding a total per project, written by whichever
 * session compacts it; corrections are one `fix:<YYYY-MM-DD>` per corrected day (corrections.ts).
 */
const prefix = { session: 'session:', closedDay: 'day:', corrections: 'fix:' } as const
export const sessionKey = (id: string) => prefix.session + id
export const closedDayKey = (day: string) => prefix.closedDay + day
export const correctionsKey = (day: string) => prefix.corrections + day
export const isSessionKey = (k: string) => k.startsWith(prefix.session)
export const isClosedDayKey = (k: string) => k.startsWith(prefix.closedDay)
export const isCorrectionsKey = (k: string) => k.startsWith(prefix.corrections)
/** Whether the key is one of the mod's own (above). */
export const isLedgerKey = (k: string) => Object.values(prefix).some(p => k.startsWith(p))
/** The day a `day:` or `fix:` key is for. */
export const dayOfKey = (k: string) => k.slice(k.indexOf(':') + 1)

const daysOf = (v: unknown): Days => ((v as SessionRecord | undefined)?.days ?? {})

/** The sessions' days merged into one, each project's intervals united: overlaps count once. */
export function merge(records: readonly unknown[]): Days {
  const out: Days = {}
  for (const r of records)
    for (const [d, projects] of Object.entries(daysOf(r)))
      for (const [p, intervals] of Object.entries(projects)) {
        const day = (out[d] ??= {})
        day[p] = union([...(day[p] ?? []), ...intervals])
      }
  return out
}

/**
 * What one session does with the store's `session:` and `day:` entries (its own key holding its
 * current record): each day before `closedBefore` becomes a total per project under its `day:` key,
 * and every other session key with only closed days is removed. `others` is the other sessions' days.
 *
 * Safe when two sessions run it at once: a total only grows to the larger of the stored one and the
 * union seen now, and a key is removed only after its days' totals are written.
 * ponytail: a session key written between another session's read and its removal loses that write;
 * `closedBefore` lags midnight by more than the inactivity limit, so a closed day no longer changes.
 */
export function ledger(entries: Readonly<Record<string, unknown>>, own: string, closedBefore: string) {
  const sessions = Object.keys(entries).filter(isSessionKey)
  const all = merge(sessions.map(k => entries[k]))
  const set: [string, DayTotals][] = []
  for (const [d, projects] of Object.entries(all)) {
    if (d >= closedBefore) continue
    const stored = (entries[closedDayKey(d)] ?? {}) as DayTotals
    const next = { ...stored }
    for (const [p, intervals] of Object.entries(projects)) next[p] = Math.max(stored[p] ?? 0, total(intervals))
    if (Object.keys(next).some(p => next[p] !== stored[p])) set.push([closedDayKey(d), next])
  }
  const remove = sessions.filter(k => k !== own && Object.keys(daysOf(entries[k])).every(d => d < closedBefore))
  const others = merge(sessions.filter(k => k !== own && !remove.includes(k)).map(k => entries[k]))
  return { set, remove, others }
}
