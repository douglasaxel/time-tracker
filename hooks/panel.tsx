// The /horas panel: the total, then the tree with each folder total in a right-hand column.
// Pure: register.ts hands it the surface's elements, the tree and what a press does.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import { strings, type Lang } from './i18n'
import { fmt } from './time'
import type { Node } from './tree'

export type PanelArgs = {
  roots: Node[]
  /** Paths of the folders the person collapsed; every other folder is open. */
  collapsed: readonly string[]
  lang: Lang
  onToggle: (path: string) => unknown
}

export function panel(ui: Elements[RenderSurface], { roots, collapsed, lang, onToggle }: PanelArgs): RenderElement {
  const { Box, Text, Button } = ui
  const s = strings[lang]
  if (!roots.length) return <Text dimColor>{s.empty}</Text>

  // Each row: a folder that opens and closes, or a project; its total right-aligned.
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
        <Text bold={isFolder}>{fmt(n.total)}</Text>
      </Box>
    )
    return [row, ...(isFolder && isOpen ? n.children.flatMap(c => rows(c, depth + 1)) : [])]
  }

  return (
    <Box flexDirection="column">
      <Box key="total" flexDirection="row" justifyContent="space-between" gap={2} marginBottom={1}>
        <Text bold>{s.total}</Text>
        <Text bold>{fmt(roots.reduce((t, n) => t + n.total, 0))}</Text>
      </Box>
      {roots.flatMap(n => rows(n, 0))}
    </Box>
  )
}
