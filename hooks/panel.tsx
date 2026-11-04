// The /horas panel: the period's total, the period and the view, then either the days (a bar as long
// as the day's hours, split by project, and each project's time) or the tree of folders, where
// pressing a folder narrows the days to it. Pure: register.ts hands it the surface's elements, the
// data and what a press does.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import type { CorrectionTarget, Filter, View } from '../types'
import { isSameTarget } from './corrections'
import { dayLabel, filters, strings, type Lang } from './i18n'
import { formatDuration, formatTotal } from './time'
import { displayPath, folderName, relativeName, type FolderDay, type Node } from './tree'

export type PanelArgs = {
  roots: Node[]
  /** Where the pane draws: the desktop's text has no fixed cell width, so it draws the bars as drawings. */
  surface: RenderSurface
  /** How wide the pane's body is, in columns: what the day bars are drawn to. */
  columns: number
  view: View
  onView: (view: View) => unknown
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
  /** The folder the person narrowed the days to. */
  selected: string | null
  /** The folder rows are named against: the selected one, or the deepest holding every project. */
  folder: string
  /** That folder's days in the period, oldest first, with each project's time. */
  days: readonly FolderDay[]
  /** A folder pressed: narrows the days to it and shows them. */
  onSelect: (path: string) => unknown
  onClearSelection: () => unknown
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
}

// Mid-luminance hues that hold on light and dark panes and stay apart from each other.
const PALETTE = ['#4C8DD6', '#2FA88A', '#D9A21B', '#B76BD1', '#E0697A', '#7C9A3A', '#46B3C9', '#C9803F']

/** A colour per project, by name so a day's order never swaps them; they repeat past the palette. */
function projectColors(days: readonly FolderDay[]): Map<string, string> {
  const names = [...new Set(days.flatMap(d => d.entries.map(e => e.project)))].sort()
  return new Map(names.map((p, i) => [p, PALETTE[i % PALETTE.length] ?? '#888888']))
}

/** The projects of a day, the longest first: the order of the bar and of the rows under it. */
const longestFirst = (d: FolderDay) => [...d.entries].sort((a, b) => b.ms - a.ms)

/** What a day's bar draws: its projects with time, the longest first. */
const barParts = (d: FolderDay) => longestFirst(d).filter(e => e.ms > 0)

/** Newest days drawn. ponytail: a fixed cap instead of paging; add paging if a year's days are wanted here. */
const MAX_DAYS = 60

const BAR_H = 10

/** The day bar as one drawing, for a surface whose text has no fixed cell width. */
function barSvg(d: FolderDay, longest: number, width: number, colors: Map<string, string>): string {
  const full = (width * d.total) / longest
  let x = 0
  const rects = barParts(d).map(e => {
    const w = (full * e.ms) / d.total
    const rect = `<rect x="${x.toFixed(1)}" width="${Math.max(1, w - 1).toFixed(1)}" height="${BAR_H}" rx="1.5" fill="${colors.get(e.project)}"/>`
    x += w
    return rect
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAR_H}" viewBox="0 0 ${width} ${BAR_H}">${rects.join('')}</svg>`
}

export function panel(ui: Elements[RenderSurface], args: PanelArgs): RenderElement {
  const { roots, surface, columns, view, onView, collapsed, lang, onToggle, paused, onPause, filter, onFilter } = args
  const { selected, folder, days, onSelect, onClearSelection, correcting, onCorrect, onAdjust, onDelete, copy, onCopy } = args
  const { Box, Text, Button } = ui
  const s = strings[lang]

  const head = (
    <Box key="head" flexDirection="row" justifyContent="space-between" gap={2} marginBottom={1}>
      <Box key="total" flexDirection="row" gap={1}>
        <Text bold>{s.total}</Text>
        <Text bold>{formatTotal(roots)}</Text>
      </Box>
      <Button key="pause" variant={paused ? 'primary' : 'secondary'} onPress={() => void onPause()}>
        {paused ? s.resume : s.pause}
      </Button>
    </Box>
  )
  const pauseNote = paused ? <Text color="warning">{s.paused}</Text> : null

  // The period: one of four, the chosen one inverted.
  const periods = (
    <Box key="filters" flexDirection="row" gap={1}>
      {(Object.keys(filters[lang]) as Filter[]).map(f => (
        <Button key={`filter:${f}`} plain onPress={() => void onFilter(f)}>
          {f === filter ? <Text inverse> {filters[lang][f]} </Text> : <Text dimColor> {filters[lang][f]} </Text>}
        </Button>
      ))}
    </Box>
  )

  const views = (
    <Box key="views" flexDirection="row" gap={2} marginTop={1} marginBottom={1}>
      {(['days', 'tree'] as const).map(v => (
        <Button key={`view:${v}`} plain onPress={() => void onView(v)}>
          <Text bold={v === view} underline={v === view} dimColor={v !== view}>
            {v === 'days' ? s.viewDays : s.viewTree}
          </Text>
        </Button>
      ))}
    </Box>
  )

  // What every view opens with.
  const top = (
    <>
      {head}
      {pauseNote}
      {periods}
      {views}
    </>
  )

  if (!roots.length && !selected)
    return (
      <Box flexDirection="column">
        {top}
        <Text dimColor>{filter === 'all' ? s.empty : s.noTime}</Text>
      </Box>
    )

  if (view === 'tree') {
    // Each row: a dim toggle (folders) or a dot (projects), then the name and the total, both pressing to its days.
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
        {roots.flatMap(n => rows(n, 0))}
        <Box key="tree-hint" marginTop={1}>
          <Text dimColor>{s.pickHint}</Text>
        </Box>
      </Box>
    )
  }

  const colors = projectColors(days)
  // Every bar shares one scale: the longest day fills the width, so bar lengths compare the days.
  const longest = Math.max(1, ...days.map(d => d.total))

  const bar = (d: FolderDay) => {
    if (d.total <= 0) return null
    if (surface === 'desktop' && 'Svg' in ui) {
      const width = Math.max(200, Math.min(900, columns * 8 - 8))
      return <ui.Svg key={`bar:${d.day}`} source={barSvg(d, longest, width, colors)} alt={`${dayLabel(d.day, lang)}: ${formatDuration(d.total)}`} width={width} height={BAR_H} />
    }
    const width = Math.max(10, columns - 2)
    return (
      <Text key={`bar:${d.day}`} wrap="truncate-end">
        {barParts(d).map(e => (
          <Text key={e.project} color={colors.get(e.project)}>
            {'█'.repeat(Math.max(1, Math.round((width * e.ms) / longest)))}
          </Text>
        ))}
      </Text>
    )
  }

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

  // A day: its label and total, its bar, then each project's dot, name and time, pressed to correct it.
  const dayBlock = (d: FolderDay) => (
    <Box key={`block:${d.day}`} flexDirection="column" marginBottom={1}>
      <Box key={`day:${d.day}`} flexDirection="row" justifyContent="space-between" gap={2}>
        <Text bold>{dayLabel(d.day, lang)}</Text>
        <Text bold>
          {formatDuration(d.total)}
          {mark(d.corrected)}
        </Text>
      </Box>
      {bar(d)}
      {longestFirst(d).flatMap(e => {
        const target = { day: d.day, project: e.project }
        const isCorrecting = isSameTarget(correcting, target)
        return [
          <Box key={`entry:${d.day}|${e.project}`} flexDirection="row" justifyContent="space-between" gap={2}>
            <Text wrap="truncate-end">
              <Text color={colors.get(e.project)}>●</Text> {displayPath(relativeName(e.project, folder), e.project)}
            </Text>
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

  const newestFirst = [...days].reverse()
  const hidden = newestFirst.length - MAX_DAYS

  return (
    <Box flexDirection="column">
      {top}
      {selected ? (
        <Box key="days-head" flexDirection="row" justifyContent="space-between" gap={2} marginBottom={1}>
          <Text bold wrap="truncate-end">
            {folderName(selected)}: {formatTotal(days)}
          </Text>
          <Button key="clear-selection" plain dimColor onPress={() => void onClearSelection()}>
            {s.allFolders}
          </Button>
        </Box>
      ) : null}
      <Box key="days" flexDirection="column">
        {days.length ? newestFirst.slice(0, MAX_DAYS).map(dayBlock) : <Text dimColor>{s.noTime}</Text>}
      </Box>
      {hidden > 0 ? (
        <Text dimColor>
          {hidden} {s.olderDays}
        </Text>
      ) : null}
      {days.some(d => d.corrected) ? <Text dimColor>{s.corrected}</Text> : null}
      {days.length ? (
        <Box key="copy-row" flexDirection="row" gap={2}>
          <Button key="copy" onPress={e => void onCopy(e.surface)}>
            {s.copy}
          </Button>
          {copy ? <Text color={copy.ok ? 'success' : 'warning'}>{copy.ok ? s.copied : s.copyFailed}</Text> : null}
        </Box>
      ) : null}
      {copy && !copy.ok ? (
        <Box key="copied-table" marginTop={1}>
          <ui.Code source={copy.text} language="markdown" />
        </Box>
      ) : null}
    </Box>
  )
}
