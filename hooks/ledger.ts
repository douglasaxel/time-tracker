// The store across sessions: the union of every session's key, and the compaction of closed days. Pure.
import type { DayTotals, Days, SessionRecord } from '../types'
import { total, union } from './time'

/** Store layout: each session writes only its own key while it runs... */
export const sessionKey = (id: string) => `session:${id}`
/** ...and a closed day is one key holding a total per project, written by whichever session compacts it. */
export const closedKey = (day: string) => `day:${day}`

const isSession = (k: string) => k.startsWith('session:')
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
 * `closedBefore` lags midnight by more than the idle limit, so a closed day no longer changes.
 */
export function ledger(entries: Readonly<Record<string, unknown>>, own: string, closedBefore: string) {
  const sessions = Object.keys(entries).filter(isSession)
  const all = merge(sessions.map(k => entries[k]))
  const set: [string, DayTotals][] = []
  for (const [d, projects] of Object.entries(all)) {
    if (d >= closedBefore) continue
    const stored = (entries[closedKey(d)] ?? {}) as DayTotals
    const next = { ...stored }
    for (const [p, intervals] of Object.entries(projects)) next[p] = Math.max(stored[p] ?? 0, total(intervals))
    if (Object.keys(next).some(p => next[p] !== stored[p])) set.push([closedKey(d), next])
  }
  const remove = sessions.filter(k => k !== own && Object.keys(daysOf(entries[k])).every(d => d < closedBefore))
  const others = merge(sessions.filter(k => k !== own && !remove.includes(k)).map(k => entries[k]))
  return { set, remove, others }
}
