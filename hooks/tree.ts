// The tree: folders from the disk root down to each project with time, single-child
// folders without time of their own folded into one node. Pure.
import type { Days } from '../types'
import { total } from './time'

export type Node = {
  /** The folder's path, `/`-separated: the key that collapses it. */
  path: string
  /** What the row shows: the folder's name, or the folded run of names. */
  name: string
  /** The folder total: its own time plus that of every folder inside it. */
  total: number
  children: Node[]
}

/** Time worked per project over `days`. */
export function projectTotals(days: Days): Record<string, number> {
  const out: Record<string, number> = {}
  for (const projects of Object.values(days))
    for (const [p, intervals] of Object.entries(projects)) out[p] = (out[p] ?? 0) + total(intervals)
  return out
}

type Raw = { path: string; name: string; own: number; children: Map<string, Raw> }

const byName = (a: Node, b: Node) => a.name.localeCompare(b.name)

const sum = (n: Raw): number => [...n.children.values()].reduce((t, c) => t + sum(c), n.own)

function fold(n: Raw): Node {
  while (n.own === 0 && n.children.size === 1) {
    const only = n.children.values().next().value as Raw
    n = { ...only, name: `${n.name}/${only.name}` }
  }
  const children = [...n.children.values()].map(fold).sort(byName)
  return { path: n.path, name: n.name, total: sum(n), children }
}

/** The roots of the tree (one per disk), folders without time left out. */
export function buildTree(totals: Record<string, number>): Node[] {
  const top: Raw = { path: '', name: '', own: 0, children: new Map() }
  for (const [project, ms] of Object.entries(totals)) {
    if (ms <= 0) continue
    const [first = '', ...rest] = project.split('/')
    let n = top
    for (const name of [first, ...rest.filter(Boolean)]) {
      const path = n === top ? name || '/' : `${n.path === '/' ? '' : n.path}/${name}`
      let child = n.children.get(name)
      if (!child) n.children.set(name, (child = { path, name, own: 0, children: new Map() }))
      n = child
    }
    n.own += ms
  }
  return [...top.children.values()].map(fold).sort(byName)
}
