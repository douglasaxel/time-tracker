// Copy as Markdown: the selected folder's days in the period as a table for the hours report. Pure.
import type { Filter } from '../types'
import { dayLabel, filters, strings, type Lang } from './i18n'
import { folderName } from './status'
import { fmt } from './time'
import { relativeName, type FolderDay } from './tree'

/** A day key as the title writes it: `12/10/2026` or `2026-10-12`. */
const date = (day: string, lang: Lang) => (lang === 'pt' ? `${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : day)

/**
 * Title with the folder and the period, one row per day and project (the path relative to the
 * folder), a Total row, `*` on corrected rows and a footnote. Hours as `Xh MMmin`, never rounded.
 * `range` is the filter's period; for every day, the first and last day with time.
 */
export function markdownTable(folder: string, days: readonly FolderDay[], filter: Filter, range: readonly [string, string], lang: Lang): string {
  const s = strings[lang]
  const [from, to] = filter === 'all' ? [days[0]?.day ?? '', days.at(-1)?.day ?? ''] : range
  const when = from === to ? date(from, lang) : `${date(from, lang)} ${s.to} ${date(to, lang)}`
  const rows = days.flatMap(d =>
    d.entries.map(e => `| ${dayLabel(d.day, lang)} | ${relativeName(e.project, folder)} | ${fmt(e.ms)}${e.corrected ? ' *' : ''} |`),
  )
  const total = fmt(days.reduce((t, d) => t + d.total, 0))
  return [
    `## ${folderName(folder)} · ${filters[lang][filter]}, ${when}`,
    '',
    `| ${s.colDate} | ${s.colProject} | ${s.colHours} |`,
    '| --- | --- | ---: |',
    ...rows,
    `| **${s.total}** | | **${total}** |`,
    '',
    ...(days.some(d => d.corrected) ? [`\\${s.corrected}`, ''] : []),
  ].join('\n')
}
