// Corrections: a manual change to one project's time on one day. Pure.
import type { DayTotals, Fixes } from '../types'
import { MIN } from './time'

/**
 * Store layout: one key per corrected day, `fix:<YYYY-MM-DD>`, holding project path -> ms added
 * (negative subtracts). Compaction never touches it; it applies on top of open and closed days alike.
 */
export const fixKey = (day: string) => `fix:${day}`

/** The time shown: measured plus the corrections, never below zero; a corrected day with no time stays at 0. */
export function applyFixes(days: Readonly<Record<string, DayTotals>>, fixes: Readonly<Fixes>): Record<string, DayTotals> {
  const out: Record<string, DayTotals> = {}
  for (const [d, projects] of Object.entries(days)) out[d] = { ...projects }
  for (const [d, projects] of Object.entries(fixes))
    for (const [p, ms] of Object.entries(projects)) (out[d] ??= {})[p] = Math.max(0, (out[d]?.[p] ?? 0) + ms)
  return out
}

/** Whether the project's day carries a correction: a `*` in the panel and in the copied table. */
export const isCorrected = (fixes: Readonly<Fixes>, day: string, project: string) => fixes[day]?.[project] !== undefined

/**
 * The ms added after a change to a day measured at `measured`: `delete` zeroes it, a number of
 * minutes adds to what is shown (a correction below zero is first lifted to zero).
 */
export function nextFix(current: number | undefined, measured: number, change: number | 'delete'): number {
  if (change === 'delete') return -measured
  return Math.max(current ?? 0, -measured) + change * MIN
}

/** `+15`, `-30`, `15`, `−30 min`: the minutes typed, or undefined. */
export function parseMinutes(text: string): number | undefined {
  const m = /^\s*([+\-−]?)\s*(\d+)\s*(min)?\s*$/i.exec(text)
  return m ? (m[1] ? (m[1] === '+' ? 1 : -1) : 1) * Number(m[2]) : undefined
}
