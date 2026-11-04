// The period picker's calendar: months as weeks of days. Pure.
import { dayKey } from './time'

/** The month a day key falls in, as `YYYY-MM`. */
export const monthOf = (day: string) => day.slice(0, 7)

const parts = (month: string) => month.split('-').map(Number) as [number, number]

/** The month `delta` months from `month`. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = parts(month)
  return monthOf(dayKey(new Date(y, m - 1 + delta, 1).getTime()))
}

/** The month's first and last day. */
export function monthRange(month: string): [string, string] {
  const [y, m] = parts(month)
  return [`${month}-01`, dayKey(new Date(y, m, 0).getTime())]
}

/** The month's weeks, Monday to Sunday; null where a week reaches into another month. */
export function monthWeeks(month: string): (string | null)[][] {
  const [y, m] = parts(month)
  const last = new Date(y, m, 0).getDate()
  const blanks = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const cells = Array<string | null>(blanks).fill(null)
  for (let d = 1; d <= last; d++) cells.push(dayKey(new Date(y, m - 1, d).getTime()))
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
}
