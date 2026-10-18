// The time model: pure functions over intervals, days and the session record. No `$` here.
import type { Days, Filter, Interval, Live, SessionMeasurement } from '../types'

export const MIN = 60_000

const pad = (n: number) => String(n).padStart(2, '0')

/** The local day an instant falls on, as `YYYY-MM-DD`. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The first and last local day of the period holding `now`. The week runs Monday to Sunday. */
export function period(filter: Filter, now: number): [string, string] {
  const d = new Date(now)
  const day = (offset: number, month = d.getMonth()) => dayKey(new Date(d.getFullYear(), month, offset).getTime())
  if (filter === 'today') return [dayKey(now), dayKey(now)]
  if (filter === 'month') return [day(1), day(0, d.getMonth() + 1)]
  if (filter === 'week') {
    const monday = d.getDate() - ((d.getDay() + 6) % 7)
    return [day(monday), day(monday + 6)]
  }
  return ['', '9999-12-31']
}

const nextMidnight = (ms: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

/** Overlapping or touching intervals merged into one, sorted. Overlaps count once. */
export function union(intervals: readonly Interval[]): Interval[] {
  const out: Interval[] = []
  for (const [s, e] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1)
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

export const total = (intervals: readonly Interval[] = []) => union(intervals).reduce((n, [s, e]) => n + e - s, 0)

/** `days` with [start, end] added under `project`, cut at each local midnight. */
export function addInterval(days: Days, project: string, start: number, end: number): Days {
  const out: Days = { ...days }
  for (let s = start; s < end; ) {
    const e = Math.min(end, nextMidnight(s))
    const day = dayKey(s)
    const projects = { ...out[day] }
    projects[project] = union([...(projects[project] ?? []), [s, e]])
    out[day] = projects
    s = e
  }
  return out
}

/** The days with the activity in progress closed at its last active instant. */
export const withLive = (days: Days, live: Live | null): Days =>
  live && live.last > live.start ? addInterval(days, live.project, live.start, live.last) : days

/** The session's days up to now: its closed intervals and the activity in progress. */
export const liveDays = (m: SessionMeasurement): Days => withLive(m.days, m.live)

/** An instant of the session: when, in which project, and the inactivity limit in force. */
export type Moment = { now: number; project: string; inactivityMs: number }

/**
 * An active instant. A gap since the last active instant up to the inactivity limit is a short
 * pause and counts; a longer gap starts a new activity. Another project (a /cd) within the limit
 * closes the old project's activity at `now` and opens the new one there.
 */
export function touch(m: SessionMeasurement, { now, project, inactivityMs }: Moment): SessionMeasurement {
  const { live } = m
  const isOn = live && now >= live.last && now - live.last <= inactivityMs
  if (isOn && live.project === project) return { ...m, live: { ...live, last: now } }
  const ended = isOn ? { ...live, last: now } : live
  return { ...m, days: withLive(m.days, ended), live: { project, start: now, last: now } }
}

/** A manual pause starting at this moment: the activity in progress closes there. */
export function startManualPause(m: SessionMeasurement, at: Moment): SessionMeasurement {
  const r = touch(m, at)
  return { ...r, days: liveDays(r), live: null }
}

/** With no activity for longer than the inactivity limit, the activity ends at its last active instant. */
export function expire(m: SessionMeasurement, now: number, inactivityMs: number): SessionMeasurement {
  if (!m.live || now - m.live.last <= inactivityMs) return m
  return { ...m, days: liveDays(m), live: null }
}

/** `Xh MMmin`, never rounded up. */
export function formatDuration(ms: number): string {
  const m = Math.floor(ms / MIN)
  return `${Math.floor(m / 60)}h ${pad(m % 60)}min`
}

/** The items' times summed, as `Xh MMmin`. */
export const formatTotal = (items: readonly { total: number }[]) => formatDuration(items.reduce((t, i) => t + i.total, 0))
