// The /horas panel: the period, then the timesheet (projects by day, one drawing on graphical
// surfaces, lines of text on the terminal) or the tree of folders, where pressing a folder narrows
// the sheet to it. A drawing takes no press, so corrections open from a button under the sheet.
// Pure: register.ts hands it the surface's elements, the data and what a press does.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import type { CorrectionTarget, Filter, Measure, PeriodPicker, View } from '../types'
import { monthOf, monthWeeks } from './calendar'
import { isSameTarget } from './corrections'
import { dayLabel, filters, monthTitle, strings, weekHeads, type Lang } from './i18n'
import { buildSheet, periodLabel, sheetColumns, sheetHeight, sheetLines, sheetSvg } from './sheet'
import { formatDuration, formatEffort, formatTotal } from './time'
import { displayPath, folderName, relativeName, type FolderDay, type Node } from './tree'

export type PanelArgs = {
  roots: Node[]
  /** Where the pane draws: every surface but the terminal draws the sheet as one drawing. */
  surface: RenderSurface
  /** How wide the pane's body is, in columns. */
  columns: number
  view: View
  onView: (view: View) => unknown
  /** Which time the cells and the tree show; both totals always read at the top. */
  measure: Measure
  onMeasure: (measure: Measure) => unknown
  /** Paths of the folders the person collapsed; every other folder is open. */
  collapsed: readonly string[]
  lang: Lang
  /** Collapses an open folder, or opens a collapsed one. */
  onToggle: (path: string) => unknown
  /** This session's manual pause and what pressing Pause or Resume does. */
  paused: boolean
  onPause: () => unknown
  filter: Filter
  onFilter: (filter: Filter) => unknown
  /** The period's first and last day, and how many periods before the current one it is. */
  range: readonly [string, string]
  offset: number
  onOffset: (offset: number) => unknown
  /** The period picker, while open, and what its presses do. */
  picker: PeriodPicker | null
  today: string
  /** Days with time worked: the calendar draws the others dim. */
  workedDays: ReadonlySet<string>
  onOpenPicker: () => unknown
  onPickerMonth: (delta: number) => unknown
  onPickDay: (day: string) => unknown
  onPickMonth: () => unknown
  /** The folder the person narrowed the sheet to. */
  selected: string | null
  /** The folder rows are named against: the selected one, or the deepest holding every project. */
  folder: string
  /** That folder's days in the period, oldest first, with each project's time. */
  days: readonly FolderDay[]
  /** A folder pressed: narrows the sheet to it and shows it. */
  onSelect: (path: string) => unknown
  onClearSelection: () => unknown
  /** Whether the list of days to correct is open, and what opens or closes it. */
  correctionsOpen: boolean
  onCorrectionsOpen: () => unknown
  /** The project day whose correction line is open. */
  correcting: CorrectionTarget | null
  /** Opens the correction line of a project day, or closes it when it is the open one. */
  onCorrect: (target: CorrectionTarget) => unknown
  /** The minutes typed (`+15`, `-30`) for the open project day. */
  onAdjust: (text: string) => unknown
  /** Zeroes the open project day for good. */
  onDelete: () => unknown
  /** The last copy's outcome and table, until the folder or the period changes. */
  copy: { ok: boolean; text: string } | null
  /** Copies the shown days' table on the surface the press came from. */
  onCopy: (surface: RenderSurface) => unknown
  /** Why the store could not be read, when it could not: the panel then shows this session only. */
  readError?: string
}

/** The mode labels under the prompt on the desktop, with the time as a button that opens the panel before them. */
export function sessionModes(ui: Elements[RenderSurface], modes: readonly string[], status: string, onPress: () => unknown): RenderElement {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="row" gap={1}>
      {modes.length ? <Text dimColor>{modes.join(' & ')}</Text> : null}
      <Button key="status-open" plain dimColor onPress={() => void onPress()}>
        {status}
      </Button>
    </Box>
  )
}

export function panel(ui: Elements[RenderSurface], args: PanelArgs): RenderElement {
  const { roots, surface, columns, view, onView, measure, onMeasure, collapsed, lang, onToggle, paused, onPause, filter, onFilter } = args
  const { range, offset, onOffset, picker, today, workedDays, onOpenPicker, onPickerMonth, onPickDay, onPickMonth } = args
  const { selected, folder, days, onSelect, onClearSelection } = args
  const { correctionsOpen, onCorrectionsOpen, correcting, onCorrect, onAdjust, onDelete, copy, onCopy } = args
  const { Box, Text, Button } = ui
  const s = strings[lang]

  const hasPeriods = filter !== 'all' && filter !== 'custom'
  const otherView = view === 'tree' ? 'days' : 'tree'
  const head = (
    <Box key="head" flexDirection="row" justifyContent="space-between" gap={2} marginBottom={1}>
      <Box key="period" flexDirection="row" gap={1}>
        {hasPeriods ? (
          <Button key="prev" plain dimColor onPress={() => void onOffset(offset - 1)}>
            ‹
          </Button>
        ) : null}
        <Button key="period-open" plain onPress={() => void onOpenPicker()}>
          <Text bold>{filter === 'all' ? filters[lang].all : periodLabel(range, lang)}</Text>
          <Text dimColor> ▾</Text>
        </Button>
        {hasPeriods && offset < 0 ? (
          <Button key="next" plain dimColor onPress={() => void onOffset(offset + 1)}>
            ›
          </Button>
        ) : null}
      </Box>
      <Button key="pause" variant={paused ? 'primary' : 'secondary'} onPress={() => void onPause()}>
        {paused ? s.resume : s.pause}
      </Button>
    </Box>
  )

  // The period's length on the left, the switch to the tree (or back) on the right.
  const controls = (
    <Box key="controls" flexDirection="row" justifyContent="space-between" gap={2} marginBottom={1}>
      <Box key="filters" flexDirection="row" gap={1}>
        {(Object.keys(filters[lang]) as Filter[]).map(f => (
          <Button key={`filter:${f}`} plain onPress={() => void onFilter(f)}>
            {f === filter ? <Text inverse> {filters[lang][f]} </Text> : <Text dimColor> {filters[lang][f]} </Text>}
          </Button>
        ))}
      </Box>
      <Button key={`view:${otherView}`} plain dimColor onPress={() => void onView(otherView)}>
        {view === 'tree' ? s.viewDays : s.viewTree}
      </Button>
    </Box>
  )

  // A day of the calendar: the period's ends inverted, the days between in blue, days without time dim.
  const [from, to] = picker?.start ? [picker.start, picker.start] : filter === 'all' ? ['', ''] : range
  const calendarDay = (day: string) => {
    const label = String(Number(day.slice(8)))
    if (day > today) return <Text dimColor>{label}</Text>
    const isEnd = day === from || day === to
    const isBetween = day > from && day < to
    return (
      <Button key={`cal-day:${day}`} plain onPress={() => void onPickDay(day)}>
        <Text inverse={isEnd} bold={isEnd || day === today} underline={day === today} color={isBetween ? '#7fb2e5' : undefined} dimColor={!isEnd && !isBetween && !workedDays.has(day)}>
          {label.padStart(2)}
        </Text>
      </Button>
    )
  }

  const calendar = picker ? (
    <Box key="calendar" flexDirection="column" marginBottom={1}>
      <Box key="cal-head" flexDirection="row" justifyContent="space-between" gap={2}>
        <Box key="cal-nav" flexDirection="row" gap={1}>
          <Button key="cal-prev" plain dimColor onPress={() => void onPickerMonth(-1)}>
            ‹
          </Button>
          <Button key="cal-month" plain onPress={() => void onPickMonth()}>
            <Text bold>{monthTitle(picker.month, lang)}</Text>
          </Button>
          {picker.month < monthOf(today) ? (
            <Button key="cal-next" plain dimColor onPress={() => void onPickerMonth(1)}>
              ›
            </Button>
          ) : null}
        </Box>
        <Button key="cal-close" plain dimColor onPress={() => void onOpenPicker()}>
          {s.close}
        </Button>
      </Box>
      <Text dimColor>{picker.start ? s.pickEnd : s.pickStart}</Text>
      <Box key="cal-heads" flexDirection="row">
        {weekHeads(lang).map(name => (
          <Box key={`cal-head:${name}`} width="14%">
            <Text dimColor>{name}</Text>
          </Box>
        ))}
      </Box>
      {monthWeeks(picker.month).map((week, w) => (
        <Box key={`cal-week:${w}`} flexDirection="row">
          {week.map((day, i) => (
            <Box key={`cal-cell:${w}:${i}`} width="14%">
              {day ? calendarDay(day) : null}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  ) : null

  // The two totals of what is shown; pressing one makes it the time the cells show.
  const times: [Measure, string, string][] = [
    ['real', s.realTime, formatTotal(days)],
    ['effort', s.effortTime, formatEffort(days)],
  ]
  const totals = (
    <Box key="measures" flexDirection="row" gap={2} marginBottom={1}>
      {times.map(([m, label, time]) => (
        <Button key={`measure:${m}`} plain onPress={() => void onMeasure(m)}>
          <Text bold={m === measure} inverse={m === measure} dimColor={m !== measure}>
            {` ${label} ${time} `}
          </Text>
        </Button>
      ))}
    </Box>
  )

  const top = (
    <Box key="top" flexDirection="column">
      {head}
      {paused ? <Text color="warning">{s.paused}</Text> : null}
      {args.readError ? (
        <Text color="warning">
          {s.readFailed} {args.readError}
        </Text>
      ) : null}
      {controls}
      {totals}
      {calendar}
    </Box>
  )

  if (!roots.length && !selected)
    return (
      <Box flexDirection="column">
        {top}
        <Text dimColor>{filter === 'all' ? s.empty : s.noTime}</Text>
      </Box>
    )

  if (view === 'tree') {
    // Each row: a dim toggle (folders) or a dot (projects), then the name and the total, both pressing to its sheet.
    const rows = (n: Node, depth: number): RenderElement[] => {
      const isFolder = n.children.length > 0
      const isOpen = !collapsed.includes(n.path)
      const select = () => void onSelect(n.path)
      return [
        <Box key={`row:${n.path}`} flexDirection="row" justifyContent="space-between" gap={2} paddingLeft={depth}>
          <Box key={`label:${n.path}`} flexDirection="row" gap={1}>
            {isFolder ? (
              <Button key={`toggle:${n.path}`} plain onPress={() => void onToggle(n.path)}>
                <Text dimColor>{isOpen ? '▾' : '▸'}</Text>
              </Button>
            ) : (
              <Text dimColor>·</Text>
            )}
            <Button key={`node:${n.path}`} plain onPress={select}>
              <Text bold={isFolder}>{displayPath(n.name || '/', n.path)}</Text>
            </Button>
          </Box>
          <Button key={`pick:${n.path}`} plain onPress={select}>
            <Text bold={isFolder} inverse={selected === n.path}>
              {formatDuration(n.total)}
            </Text>
          </Button>
        </Box>,
        ...(isFolder && isOpen ? n.children.flatMap(c => rows(c, depth + 1)) : []),
      ]
    }
    return (
      <Box flexDirection="column">
        {top}
        <Box key="total" flexDirection="row" justifyContent="space-between" gap={2} marginBottom={1}>
          <Text bold>{s.total}</Text>
          <Text bold>{formatTotal(roots)}</Text>
        </Box>
        {roots.flatMap(n => rows(n, 0))}
        <Box key="tree-hint" marginTop={1}>
          <Text dimColor>{s.pickHint}</Text>
        </Box>
      </Box>
    )
  }

  const sheet = buildSheet(sheetColumns(filter, range, days, lang), days, measure, lang)
  const width = Math.max(240, Math.min(900, columns * 8 - 8))
  const alt = sheet.rows.map(r => `${r.name}: ${formatDuration(r.total)}`).join(', ')
  const table =
    surface !== 'terminal' && 'Svg' in ui ? (
      <ui.Svg key="sheet" source={sheetSvg(sheet, width, lang)} alt={alt} width={width} height={sheetHeight(sheet)} />
    ) : (
      <Box key="sheet" flexDirection="column">
        {sheetLines(sheet, columns, lang).map(l => (
          <Box key={l.key}>
            <Text bold={l.key === 'sheet-total' || l.key.startsWith('sheet-group:')} dimColor={l.key === 'sheet-head' || l.key === 'sheet-sub'} wrap="truncate-end">
              {l.text}
            </Text>
          </Box>
        ))}
      </Box>
    )

  const mark = (corrected: boolean) => (corrected ? <Text color="warning"> *</Text> : '')

  // The correction line under the open row: minutes to add or subtract (no field on mobile), and delete.
  const correctionLine = (
    <Box key="correction" flexDirection="row" gap={2} paddingLeft={2}>
      {'Input' in ui ? <ui.Input key="adjust" label={s.adjust} placeholder={s.adjustHint} onSubmit={v => void onAdjust(v)} /> : null}
      <Button key="delete" onPress={() => void onDelete()}>
        {s.deleteDay}
      </Button>
    </Box>
  )

  // A day to correct: its label and total, then each project's name and time, pressed to correct it.
  const dayBlock = (d: FolderDay) => (
    <Box key={`block:${d.day}`} flexDirection="column" marginBottom={1}>
      <Box key={`day:${d.day}`} flexDirection="row" justifyContent="space-between" gap={2}>
        <Text bold>{dayLabel(d.day, lang)}</Text>
        <Text bold>
          {formatDuration(d.total)}
          {mark(d.corrected)}
        </Text>
      </Box>
      {[...d.entries].sort((a, b) => b.ms - a.ms).flatMap(e => {
        const target = { day: d.day, project: e.project }
        const isCorrecting = isSameTarget(correcting, target)
        return [
          <Box key={`entry:${d.day}|${e.project}`} flexDirection="row" justifyContent="space-between" gap={2}>
            <Text wrap="truncate-end">{displayPath(relativeName(e.project, folder), e.project)}</Text>
            <Button key={`fix:${d.day}|${e.project}`} plain onPress={() => void onCorrect(target)}>
              <Text inverse={isCorrecting}>{formatDuration(e.ms)}</Text>
              {mark(e.corrected)}
            </Button>
          </Box>,
          ...(isCorrecting ? [correctionLine] : []),
        ]
      })}
    </Box>
  )

  return (
    <Box flexDirection="column">
      {top}
      {selected ? (
        <Box key="days-head" flexDirection="row" justifyContent="space-between" gap={2} marginBottom={1}>
          <Text bold wrap="truncate-end">
            {folderName(selected)}
          </Text>
          <Button key="clear-selection" plain dimColor onPress={() => void onClearSelection()}>
            {s.allFolders}
          </Button>
        </Box>
      ) : null}
      {days.length ? table : <Text dimColor>{s.noTime}</Text>}
      {days.some(d => d.corrected) ? <Text dimColor>{s.corrected}</Text> : null}
      {days.length ? (
        <Box key="actions" flexDirection="row" gap={2} marginTop={1}>
          <Button key="copy" onPress={e => void onCopy(e.surface)}>
            {s.copy}
          </Button>
          <Button key="corrections-toggle" onPress={() => void onCorrectionsOpen()}>
            {s.correct}
          </Button>
        </Box>
      ) : null}
      {copy ? <Text color={copy.ok ? 'success' : 'warning'}>{copy.ok ? s.copied : s.copyFailed}</Text> : null}
      {copy && !copy.ok ? (
        <Box key="copied-table" marginTop={1}>
          <ui.Code source={copy.text} language="markdown" />
        </Box>
      ) : null}
      {correctionsOpen ? (
        <Box key="days" flexDirection="column" marginTop={1}>
          {[...days].reverse().map(dayBlock)}
        </Box>
      ) : null}
    </Box>
  )
}
