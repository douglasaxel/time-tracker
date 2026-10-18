// The status line text: `⏱ <time today> today · <project folder>`, `⏸` while paused. Pure.
import type { Days, Rec } from '../types'
import { strings, type Lang } from './i18n'
import { dayKey, fmt, total, withLive } from './time'

export const folderName = (project: string) => project.split('/').filter(Boolean).at(-1) ?? project

/** Today's time worked in `project`: this session's intervals united with the other sessions' `others`. */
export function statusText(rec: Rec, now: number, project: string, lang: Lang, others: Days = {}, paused = false): string {
  const day = dayKey(now)
  const today = [...(withLive(rec.days, rec.live)[day]?.[project] ?? []), ...(others[day]?.[project] ?? [])]
  return `${paused ? '⏸' : '⏱'} ${fmt(total(today))} ${strings[lang].today} · ${folderName(project)}`
}
