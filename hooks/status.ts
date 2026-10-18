// The status line text: `⏱ <time today> today · <project folder>`. Pure.
import type { Rec } from '../types'
import { strings, type Lang } from './i18n'
import { dayKey, fmt, total, withLive } from './time'

export const folderName = (project: string) => project.split('/').filter(Boolean).at(-1) ?? project

export function statusText(rec: Rec, now: number, project: string, lang: Lang): string {
  // ponytail: this session's own intervals only; the union with other sessions comes with #4.
  const today = withLive(rec.days, rec.live)[dayKey(now)]?.[project]
  return `⏱ ${fmt(total(today))} ${strings[lang].today} · ${folderName(project)}`
}
