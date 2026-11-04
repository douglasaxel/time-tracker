// The store across sessions: the union of every session's key, and the compaction of closed days. Pure.
import type { AgentDays, DayTotals, Days, SessionRecord } from '../types'
import { effortTime, total, union } from './time'

/**
 * Store layout, every key the mod writes: each session writes only its own `session:<id>` while it
 * runs; a closed day is one `day:<YYYY-MM-DD>` holding a total per project, written by whichever
 * session compacts it; `effort:<YYYY-MM-DD>` holds a closed day's time with each subagent counted,
 * only where it differs from the time worked; corrections are one `fix:<YYYY-MM-DD>` per corrected
 * day (corrections.ts).
 */
const prefix = { session: 'session:', closedDay: 'day:', effort: 'effort:', corrections: 'fix:' } as const
export const sessionKey = (id: string) => prefix.session + id
export const closedDayKey = (day: string) => prefix.closedDay + day
export const effortKey = (day: string) => prefix.effort + day
export const correctionsKey = (day: string) => prefix.corrections + day
export const isSessionKey = (k: string) => k.startsWith(prefix.session)
export const isClosedDayKey = (k: string) => k.startsWith(prefix.closedDay)
export const isEffortKey = (k: string) => k.startsWith(prefix.effort)
export const isCorrectionsKey = (k: string) => k.startsWith(prefix.corrections)
/** Whether the key is one of the mod's own (above). */
export const isLedgerKey = (k: string) => Object.values(prefix).some(p => k.startsWith(p))
/** The day a `day:`, `effort:` or `fix:` key is for. */
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

/** The sessions' subagents, by the day and project they worked in. */
export function mergeAgents(records: readonly unknown[]): AgentDays {
  const out: AgentDays = {}
  for (const r of records)
    for (const days of Object.values((r as SessionRecord | undefined)?.agents ?? {}))
      for (const [d, projects] of Object.entries(days))
        for (const [p, intervals] of Object.entries(projects)) ((out[d] ??= {})[p] ??= []).push(intervals)
  return out
}

/**
 * What one session does with the store's entries (its own key holding its current record): each day
 * before `closedBefore` becomes a total per project under its `day:` key and, with subagents counted,
 * its `effort:` key, and every other session key with only closed days is removed. `others` is the
 * other sessions' records still kept.
 *
 * Safe when two sessions run it at once: a total only grows to the larger of the stored one and the
 * union seen now, and a key is removed only after its days' totals are written.
 * ponytail: a session key written between another session's read and its removal loses that write;
 * `closedBefore` lags midnight by more than the inactivity limit, so a closed day no longer changes.
 */
export function ledger(entries: Readonly<Record<string, unknown>>, own: string, closedBefore: string) {
  const sessions = Object.keys(entries).filter(isSessionKey)
  const all = merge(sessions.map(k => entries[k]))
  const agents = mergeAgents(sessions.map(k => entries[k]))
  const set: [string, DayTotals][] = []
  const grow = (key: string, times: [string, number][]) => {
    const stored = (entries[key] ?? {}) as DayTotals
    const next = { ...stored }
    for (const [p, ms] of times) next[p] = Math.max(stored[p] ?? 0, ms)
    if (Object.keys(next).some(p => next[p] !== stored[p])) set.push([key, next])
  }
  for (const [d, projects] of Object.entries(all)) {
    if (d >= closedBefore) continue
    grow(closedDayKey(d), Object.entries(projects).map(([p, intervals]) => [p, total(intervals)]))
    grow(effortKey(d), Object.entries(agents[d] ?? {}).map(([p, runs]) => [p, effortTime(projects[p] ?? [], runs)]))
  }
  const remove = sessions.filter(k => k !== own && Object.keys(daysOf(entries[k])).every(d => d < closedBefore))
  const others = sessions.filter(k => k !== own && !remove.includes(k)).map(k => entries[k])
  return { set, remove, others }
}
