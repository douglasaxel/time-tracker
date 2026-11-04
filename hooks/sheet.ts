// The timesheet: projects in the rows, the period's days (or weeks, or months) in the columns. Pure.
import type { Filter } from '../types'
import { dayLabel, strings, weekday, type Lang } from './i18n'
import { MIN, dayKey } from './time'
import { displayPath, folderName, type FolderDay } from './tree'

type SheetColumn = { from: string; to: string; head: string; sub: string }
type SheetRow = { project: string; name: string; cells: number[]; corrected: boolean[]; total: number }
type Sheet = { columns: SheetColumn[]; rows: SheetRow[]; totals: number[]; total: number }

/** Time as a cell reads it: `13h02`, `48min`. Minutes are never rounded up. */
function cellTime(ms: number): string {
  const m = Math.floor(ms / MIN)
  return m < 60 ? `${m}min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** What a cell reads: its time, starred when corrected, or a dot when it has neither. */
const cellText = (ms: number, corrected = false) => (ms > 0 || corrected ? `${cellTime(ms)}${corrected ? '*' : ''}` : '·')

const clip = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t)

/** A day as a period label writes it, without its weekday: `12/10` or `Oct 12`. */
const shortDay = (day: string, lang: Lang, withYear: boolean) => dayLabel(day, lang, withYear).split(' ').slice(1).join(' ')

/** The period as the header writes it: one day with its weekday, or from one day to another, with the year when they differ in it. */
export function periodLabel([from, to]: readonly [string, string], lang: Lang): string {
  if (from === to) return dayLabel(from, lang)
  const withYear = from.slice(0, 4) !== to.slice(0, 4)
  return `${shortDay(from, lang, withYear)} ${strings[lang].to} ${shortDay(to, lang, withYear)}`
}

const everyDay = (from: string, to: string): string[] => {
  const [y = 0, m = 1, d = 1] = from.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; ; i++) {
    const day = dayKey(new Date(y, m - 1, d + i).getTime())
    if (day > to) return out
    out.push(day)
  }
}

/** Most months a sheet of every day shows; older ones join one column. */
const MAX_MONTHS = 8

/** Most days a picked period shows one by one, and most it shows as weeks; longer ones show months. */
const MAX_DAY_COLUMNS = 8
const MAX_WEEK_DAYS = 70

/** The columns of a period: its days for a week or a day, its weeks for a month, the months for all time; a picked period by its length. */
export function sheetColumns(filter: Filter, range: readonly [string, string], days: readonly FolderDay[], lang: Lang): SheetColumn[] {
  const [from, to] = range
  const length = filter === 'custom' ? everyDay(from, to).length : 0
  if (filter === 'all' || length > MAX_WEEK_DAYS) {
    const months = [...new Set(days.map(d => d.day.slice(0, 7)))].sort()
    const recent = months.slice(-MAX_MONTHS)
    const columns = recent.map(m => ({ from: `${m}-01`, to: `${m}-31`, head: `${m.slice(5)}/${m.slice(2, 4)}`, sub: '' }))
    const [oldest] = recent
    if (oldest && months.length > recent.length) columns.unshift({ from: '', to: `${oldest}-00`, head: strings[lang].before, sub: '' })
    return columns
  }
  if (filter === 'month' || length > MAX_DAY_COLUMNS) {
    const weeks: SheetColumn[] = []
    for (const day of everyDay(from, to)) {
      const last = weeks.at(-1)
      if (last && weekday(day) !== 1) last.to = day
      else weeks.push({ from: day, to: day, head: '', sub: '' })
    }
    return weeks.map(w => ({
      ...w,
      head: filter === 'custom' ? `${w.from.slice(8)}/${w.from.slice(5, 7)}` : w.from.slice(8),
      sub: `${strings[lang].to} ${w.to.slice(8)}`,
    }))
  }
  return everyDay(from, to).map(day => ({ from: day, to: day, head: dayLabel(day, lang).split(' ')[0] ?? '', sub: day.slice(8) }))
}

/** Each project's last folder name; two with the same one also show their parent. */
function projectNames(projects: readonly string[]): Map<string, string> {
  const seen = new Map<string, number>()
  for (const p of projects) seen.set(folderName(p), (seen.get(folderName(p)) ?? 0) + 1)
  return new Map(
    projects.map(p => {
      const name = (seen.get(folderName(p)) ?? 0) > 1 ? p.split('/').filter(Boolean).slice(-2).join('/') : folderName(p)
      return [p, displayPath(/^[a-z]:$/i.test(name) ? `${name}/` : name, p)]
    }),
  )
}

/** The period's sheet: the projects with the most time first, a total per row and per column. */
export function buildSheet(columns: SheetColumn[], days: readonly FolderDay[]): Sheet {
  const totalsByProject = new Map<string, number>()
  for (const d of days) for (const e of d.entries) totalsByProject.set(e.project, (totalsByProject.get(e.project) ?? 0) + e.ms)
  const projects = [...totalsByProject.keys()].sort((a, b) => (totalsByProject.get(b) ?? 0) - (totalsByProject.get(a) ?? 0) || a.localeCompare(b))
  const names = projectNames(projects)
  const rows = projects.map((project): SheetRow => {
    const cells = columns.map(() => 0)
    const corrected = columns.map(() => false)
    for (const d of days) {
      const i = columns.findIndex(c => d.day >= c.from && d.day <= c.to)
      const e = d.entries.find(x => x.project === project)
      if (i < 0 || !e) continue
      cells[i] = (cells[i] ?? 0) + e.ms
      corrected[i] = corrected[i] || e.corrected
    }
    return { project, name: names.get(project) ?? project, cells, corrected, total: totalsByProject.get(project) ?? 0 }
  })
  const totals = columns.map((_, i) => rows.reduce((n, r) => n + (r.cells[i] ?? 0), 0))
  return { columns, rows, totals, total: rows.reduce((n, r) => n + r.total, 0) }
}

const xml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"
const HEAD_H = 40
const ROW_H = 32

export const sheetHeight = (s: Sheet) => HEAD_H + ROW_H * (s.rows.length + 1)

/** The sheet as one drawing: the more time in a cell, the stronger its blue. */
export function sheetSvg(s: Sheet, width: number, lang: Lang): string {
  const totalW = 54
  const nameW = Math.min(112, Math.round(width * 0.25))
  const cellW = (width - nameW - totalW) / Math.max(1, s.columns.length)
  const cellX = (i: number) => nameW + cellW * i
  const cellMid = (i: number) => cellX(i) + cellW / 2
  const size = cellW < 36 ? 10.5 : 12
  const maxChars = Math.floor(nameW / 6.6)
  const text = (x: number, y: number, t: string, cls: string, anchor = 'middle', fontSize = size) =>
    `<text class="${cls}" x="${x.toFixed(1)}" y="${y}" text-anchor="${anchor}" font-size="${fontSize}">${xml(t)}</text>`
  const line = (y: number) => `<line class="l" x1="0" x2="${width}" y1="${y + 0.5}" y2="${y + 0.5}"/>`

  const head = s.columns
    .map((c, i) => text(cellMid(i), 15, c.head, 's') + (c.sub ? text(cellMid(i), 31, c.sub, 's', 'middle', 11) : ''))
    .join('')
  const rows = s.rows
    .map((r, ri) => {
      const y = HEAD_H + ROW_H * ri
      const mid = y + ROW_H / 2 + 4
      const cells = r.cells
        .map((ms, i) => {
          const label = cellText(ms, r.corrected[i])
          if (ms <= 0 && !r.corrected[i]) return text(cellMid(i), mid, label, 'm')
          const alpha = Math.min(0.75, 0.1 + ms / MIN / 900).toFixed(2)
          return `<rect x="${cellX(i).toFixed(1)}" y="${y + 1}" width="${cellW.toFixed(1)}" height="${ROW_H - 1}" fill="#7fb2e5" fill-opacity="${alpha}"/>${text(cellMid(i), mid, label, 't')}`
        })
        .join('')
      return line(y) + text(0, mid, clip(r.name, maxChars), 't', 'start', 12.5) + cells + text(width, mid, cellTime(r.total), 't b', 'end')
    })
    .join('')
  const footY = HEAD_H + ROW_H * s.rows.length
  const foot =
    line(footY) +
    text(0, footY + 20, strings[lang].total, 't b', 'start', 12.5) +
    s.totals.map((ms, i) => text(cellMid(i), footY + 20, cellText(ms), ms > 0 ? 't b' : 'm')).join('') +
    text(width, footY + 20, cellTime(s.total), 't b', 'end')
  const height = sheetHeight(s)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-variant-numeric="tabular-nums"><style>.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#a8a8a4}.l{stroke:#e4e4e1}.b{font-weight:600}@media (prefers-color-scheme: dark){.t{fill:#ecebe6}.s{fill:#9a9994}.m{fill:#5e5d59}.l{stroke:#333331}}</style>${head}${text(width, 15, strings[lang].total, 't b', 'end')}${rows}${foot}</svg>`
}

/** The sheet as lines of text, for a surface with fixed cells: each column right-aligned. */
export function sheetLines(s: Sheet, columns: number, lang: Lang): { key: string; text: string }[] {
  const cell = 6
  const totalW = 7
  const nameW = Math.max(6, Math.min(16, columns - totalW - cell * s.columns.length))
  const line = (label: string, cells: string[], total: string) => `${clip(label, nameW).padEnd(nameW)}${cells.map(c => c.padStart(cell)).join('')}${total.padStart(totalW)}`
  return [
    { key: 'sheet-head', text: line('', s.columns.map(c => c.head), strings[lang].total) },
    ...(s.columns.some(c => c.sub) ? [{ key: 'sheet-sub', text: line('', s.columns.map(c => c.sub), '') }] : []),
    ...s.rows.map(r => ({
      key: `sheet:${r.project}`,
      text: line(r.name, r.cells.map((ms, i) => cellText(ms, r.corrected[i])), cellTime(r.total)),
    })),
    { key: 'sheet-total', text: line(strings[lang].total, s.totals.map(ms => cellText(ms)), cellTime(s.total)) },
  ]
}
