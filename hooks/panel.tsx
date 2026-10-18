// The /horas panel: the period filters, the total, the tree with each folder total in a right-hand
// column, and the selected folder's days. Pure: register.ts hands it the surface's elements, the
// tree and what a press does.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import type { CorrectionTarget, Filter } from '../types'
import { isSameTarget } from './corrections'
import { dayLabel, filters, strings, type Lang } from './i18n'
import { formatDuration, formatTotal } from './time'
import { displayPath, folderName, relativeName, type FolderDay, type Node } from './tree'

export type PanelArgs = {
  roots: Node[]
  /** Paths of the folders the person collapsed; every other folder is open. */
  collapsed: readonly string[]
  lang: Lang
  /** Collapses an open folder, or opens a collapsed one. */
  onToggle: (path: string) => unknown
  /** This session's manual pause and what pressing Pause or Resume does. */
  paused: boolean
  onPause: () => unknown
  filter: Filter
  /** The selected folder's path and its days in the period, oldest first, each project's time on them. */
  selected: { path: string; days: readonly FolderDay[] } | null
  onFilter: (filter: Filter) => unknown
  /** A folder's name pressed: selects it and opens it. */
  onSelect: (path: string) => unknown
  /** A folder's time pressed: selects it, or clears the selection when it is the selected one. */
  onPick: (path: string) => unknown
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
  /** Copies the selected folder's table on the surface the press came from. */
  onCopy: (surface: RenderSurface) => unknown
}

export function panel(ui: Elements[RenderSurface], args: PanelArgs): RenderElement {
  const { roots, collapsed, lang, onToggle, paused, onPause, filter, selected, onFilter, onSelect, onPick } = args
  const { correcting, onCorrect, onAdjust, onDelete, copy, onCopy } = args
  const { Box, Text, Button } = ui
  const s = strings[lang]

  // Pause or Resume first, with the reason the count stands still while paused.
  const control = (
    <Box key="control" flexDirection="row" gap={2} marginBottom={1}>
      <Button key="pause" variant={paused ? 'primary' : 'secondary'} onPress={() => void onPause()}>
        {paused ? s.resume : s.pause}
      </Button>
      {paused ? <Text color="warning">{s.paused}</Text> : null}
    </Box>
  )

  // One choice of four, so radio marks; digits 1-4 press them while the pane has the focus.
  const bar = (
    <Box key="filters" flexDirection="row" gap={2} marginBottom={1}>
      {(Object.keys(filters[lang]) as Filter[]).map((f, i) => (
        <Button key={`filter:${f}`} plain hotkey={String(i + 1)} onPress={() => void onFilter(f)}>
          {f === filter ? <Text bold>● {filters[lang][f]}</Text> : <Text dimColor>○ {filters[lang][f]}</Text>}
        </Button>
      ))}
    </Box>
  )

  if (!roots.length)
    return (
      <Box flexDirection="column">
        {control}
        {bar}
        <Text dimColor>{filter === 'all' ? s.empty : s.noTime}</Text>
      </Box>
    )

  // Each row: a small dim toggle (folders) or a dot (projects), the name that selects it, and its
  // total right-aligned, pressed to select it or clear the selection.
  const rows = (n: Node, depth: number): RenderElement[] => {
    const isFolder = n.children.length > 0
    const isOpen = !collapsed.includes(n.path)
    const row = (
      <Box key={`row:${n.path}`} flexDirection="row" justifyContent="space-between" gap={2} paddingLeft={depth * 2}>
        <Box key={`label:${n.path}`} flexDirection="row" gap={1}>
          {isFolder ? (
            <Button key={`toggle:${n.path}`} plain onPress={() => void onToggle(n.path)}>
              <Text dimColor>{isOpen ? '▾' : '▸'}</Text>
            </Button>
          ) : (
            <Text dimColor>·</Text>
          )}
          <Button key={`node:${n.path}`} plain onPress={() => void onSelect(n.path)}>
            <Text bold={isFolder}>{displayPath(n.name || '/', n.path)}</Text>
          </Button>
        </Box>
        <Button key={`pick:${n.path}`} plain onPress={() => void onPick(n.path)}>
          <Text bold={isFolder} inverse={selected?.path === n.path}>
            {formatDuration(n.total)}
          </Text>
        </Button>
      </Box>
    )
    return [row, ...(isFolder && isOpen ? n.children.flatMap(c => rows(c, depth + 1)) : [])]
  }

  // A project's time on a day, pressed to open its correction line; `*` marks a corrected one.
  const mark = (corrected: boolean) => (corrected ? <Text color="warning"> *</Text> : '')
  const correctable = (target: CorrectionTarget, ms: number, corrected: boolean) => (
    <Button key={`fix:${target.day}|${target.project}`} plain onPress={() => void onCorrect(target)}>
      <Text inverse={isSameTarget(correcting, target)}>{formatDuration(ms)}</Text>
      {mark(corrected)}
    </Button>
  )
  // The correction line under the open row: minutes to add or subtract (no field on mobile), and delete.
  const correctionLine = (indent: number) => (
    <Box key="correction" flexDirection="row" gap={2} paddingLeft={indent}>
      {'Input' in ui ? <ui.Input key="adjust" label={s.adjust} placeholder={s.adjustHint} onSubmit={v => void onAdjust(v)} /> : null}
      <Button key="delete" onPress={() => void onDelete()}>
        {s.deleteDay}
      </Button>
    </Box>
  )

  // A day of the selected project takes the correction on its own row; a folder's day lists its projects.
  const dayRows = (d: FolderDay, folder: string): RenderElement[] => {
    const own = d.entries.length === 1 && d.entries[0]?.project === folder ? d.entries[0] : undefined
    const isOpen = (project: string) => isSameTarget(correcting, { day: d.day, project })
    const head = (
      <Box key={`day:${d.day}`} flexDirection="row" justifyContent="space-between" gap={2} paddingLeft={2}>
        <Text>{dayLabel(d.day, lang)}</Text>
        {own ? correctable({ day: d.day, project: own.project }, own.ms, own.corrected) : <Text>{formatDuration(d.total)}{mark(d.corrected)}</Text>}
      </Box>
    )
    if (own) return [head, ...(isOpen(own.project) ? [correctionLine(4)] : [])]
    return [
      head,
      ...d.entries.flatMap(e => [
        <Box key={`entry:${d.day}|${e.project}`} flexDirection="row" justifyContent="space-between" gap={2} paddingLeft={4}>
          <Text dimColor wrap="truncate-end">{displayPath(relativeName(e.project, folder), e.project)}</Text>
          {correctable({ day: d.day, project: e.project }, e.ms, e.corrected)}
        </Box>,
        ...(isOpen(e.project) ? [correctionLine(6)] : []),
      ]),
    ]
  }

  // The copy and what came of it, said next to the button; a refused copy shows the table to copy by hand.
  const copyRow = (
    <Box key="copy-row" flexDirection="row" gap={2} marginTop={1}>
      <Button key="copy" onPress={e => void onCopy(e.surface)}>
        {s.copy}
      </Button>
      {copy ? <Text color={copy.ok ? 'success' : 'warning'}>{copy.ok ? s.copied : s.copyFailed}</Text> : null}
    </Box>
  )

  const picked = selected && (
    <Box key="days" flexDirection="column" marginTop={1}>
      <Box key="days-head" flexDirection="row" justifyContent="space-between" gap={2}>
        <Text bold wrap="truncate-end">{folderName(selected.path)}</Text>
        <Text bold>{formatTotal(selected.days)}</Text>
      </Box>
      {selected.days.length ? selected.days.flatMap(d => dayRows(d, selected.path)) : <Text dimColor>{s.noTime}</Text>}
      {selected.days.some(d => d.corrected) ? <Text dimColor>{s.corrected}</Text> : null}
      {selected.days.length ? copyRow : null}
      {copy && !copy.ok ? (
        <Box key="copied-table" marginTop={1}>
          <ui.Code source={copy.text} language="markdown" />
        </Box>
      ) : null}
    </Box>
  )

  return (
    <Box flexDirection="column">
      {control}
      {bar}
      <Box key="total" flexDirection="row" justifyContent="space-between" gap={2} marginBottom={1}>
        <Text bold>{s.total}</Text>
        <Text bold>{formatTotal(roots)}</Text>
      </Box>
      {roots.flatMap(n => rows(n, 0))}
      {picked || <Text dimColor>{s.pickHint}</Text>}
    </Box>
  )
}
