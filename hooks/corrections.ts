// Corrections: a manual change to one project's time on one day. Pure.
// Stored per corrected day under `fix:<YYYY-MM-DD>` (ledger.ts); compaction never touches them.
import type { Correction, CorrectionTarget, Corrections, DayTotals } from '../types'
import { MIN } from './time'

type Deleted = Extract<Correction, object>

/** Whether the correction deletes the day; the older plain number form never does. */
const isDeleted = (c: Correction | undefined): c is Deleted => typeof c === 'object' && c !== null && c.deleted === true

/** A project day's time as shown: never below zero; a deleted day counts only what was added after. */
const shownTime = (measured: number, c: Correction) => Math.max(0, isDeleted(c) ? c.ms : measured + c)

/** The time shown: measured plus the corrections; a corrected day with no time measured is shown too. */
export function applyCorrections(days: Readonly<Record<string, DayTotals>>, corrections: Readonly<Corrections>): Record<string, DayTotals> {
  const out: Record<string, DayTotals> = {}
  for (const [d, projects] of Object.entries(days)) out[d] = { ...projects }
  for (const [d, projects] of Object.entries(corrections))
    for (const [p, c] of Object.entries(projects)) (out[d] ??= {})[p] = shownTime(out[d]?.[p] ?? 0, c)
  return out
}

/** Whether the project's day carries a correction: a `*` in the panel and in the copied table. */
export const isCorrected = (corrections: Readonly<Corrections>, { day, project }: CorrectionTarget) =>
  corrections[day]?.[project] !== undefined

export const isSameTarget = (a: CorrectionTarget | null, b: CorrectionTarget) => a?.day === b.day && a.project === b.project

/**
 * The correction after a change to a day measured at `measured`: `delete` zeroes it for good, a
 * number of minutes adds to what is shown (a correction below zero is first lifted to zero).
 */
export function nextCorrection(current: Correction | undefined, measured: number, change: number | 'delete'): Correction {
  if (change === 'delete') return { deleted: true, ms: 0 }
  if (isDeleted(current)) return { deleted: true, ms: Math.max(0, current.ms) + change * MIN }
  return Math.max(current ?? 0, -measured) + change * MIN
}

/** `+15`, `-30`, `15`, `−30 min`: the minutes typed, or undefined. */
export function parseMinutes(text: string): number | undefined {
  const m = /^\s*([+\-−]?)\s*(\d+)\s*(min)?\s*$/i.exec(text)
  if (!m) return undefined
  const sign = m[1] === '-' || m[1] === '−' ? -1 : 1
  return sign * Number(m[2])
}
