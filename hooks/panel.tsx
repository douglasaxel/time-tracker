// The /horas panel: the period filters, the total, the tree with each folder total in a right-hand
// column, and the selected folder's days. Pure: register.ts hands it the surface's elements, the
// tree and what a press does.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import type { Filter } from '../types'
import { dayLabel, filters, strings, type Lang } from './i18n'
import { folderName } from './status'
import { fmt } from './time'
import type { Node } from './tree'

export type PanelArgs = {
  roots: Node[]
  /** Paths of the folders the person collapsed; every other folder is open. */
  collapsed: readonly string[]
  lang: Lang
  onToggle: (path: string) => unknown
  /** This session's manual pause (#8) and what pressing Pause or Resume does. */
  paused: boolean
  onPause: () => unknown
  // #5 days and filters
  filter: Filter
  /** The selected folder's path and its days in the period, oldest first. */
  selected: { path: string; days: readonly [string, number][] } | null
  onFilter: (filter: Filter) => unknown
  /** Selects a folder, or clears the selection when it is the selected one. */
  onPick: (path: string) => unknown
}

export function panel(ui: Elements[RenderSurface], args: PanelArgs): RenderElement {
  const { roots, collapsed, lang, onToggle, paused, onPause, filter, selected, onFilter, onPick } = args
  const { Box, Text, Button } = ui
  const s = strings[lang]

  // #8: Pause or Resume first, with the reason the count stands still while paused.
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

  // Each row: a folder that opens and closes, or a project; its total right-aligned, pressed to select it.
  const rows = (n: Node, depth: number): RenderElement[] => {
    const isFolder = n.children.length > 0
    const isOpen = !collapsed.includes(n.path)
    const name = n.name || '/'
    const row = (
      <Box key={`row:${n.path}`} flexDirection="row" justifyContent="space-between" gap={2} paddingLeft={depth * 2}>
        {isFolder ? (
          <Button key={`node:${n.path}`} plain onPress={() => void onToggle(n.path)}>
            {isOpen ? '▾' : '▸'} <Text bold>{name}</Text>
          </Button>
        ) : (
          <Text wrap="truncate-end">
            <Text dimColor>·</Text> {name}
          </Text>
        )}
        <Button key={`pick:${n.path}`} plain onPress={() => void onPick(n.path)}>
          <Text bold={isFolder} inverse={selected?.path === n.path}>
            {fmt(n.total)}
          </Text>
        </Button>
      </Box>
    )
    return [row, ...(isFolder && isOpen ? n.children.flatMap(c => rows(c, depth + 1)) : [])]
  }

  const picked = selected && (
    <Box key="days" flexDirection="column" marginTop={1}>
      <Box key="days-head" flexDirection="row" justifyContent="space-between" gap={2}>
        <Text bold wrap="truncate-end">{folderName(selected.path)}</Text>
        <Text bold>{fmt(selected.days.reduce((t, [, ms]) => t + ms, 0))}</Text>
      </Box>
      {selected.days.length ? (
        selected.days.map(([day, ms]) => (
          <Box key={`day:${day}`} flexDirection="row" justifyContent="space-between" gap={2} paddingLeft={2}>
            <Text>{dayLabel(day, lang)}</Text>
            <Text>{fmt(ms)}</Text>
          </Box>
        ))
      ) : (
        <Text dimColor>{s.noTime}</Text>
      )}
    </Box>
  )

  return (
    <Box flexDirection="column">
      {control}
      {bar}
      <Box key="total" flexDirection="row" justifyContent="space-between" gap={2} marginBottom={1}>
        <Text bold>{s.total}</Text>
        <Text bold>{fmt(roots.reduce((t, n) => t + n.total, 0))}</Text>
      </Box>
      {roots.flatMap(n => rows(n, 0))}
      {picked || <Text dimColor>{s.pickHint}</Text>}
    </Box>
  )
}
