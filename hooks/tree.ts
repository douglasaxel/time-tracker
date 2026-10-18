// The tree: folders from the disk root down to each project with time, single-child
// folders without time of their own folded into one node. Pure.
import type { DayTotals, Days } from '../types'
import { merge } from './ledger'
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

/**
 * Time worked per day and project: this session's and the other sessions' intervals united
 * (overlaps count once), and a closed day's stored total where it is the larger.
 */
export function dayTotals(own: Days, others: Days, closed: Readonly<Record<string, DayTotals>>): Record<string, DayTotals> {
  const out: Record<string, DayTotals> = {}
  for (const [day, projects] of Object.entries(closed)) out[day] = { ...projects }
  for (const [day, projects] of Object.entries(merge([{ days: own }, { days: others }]))) {
    const d = (out[day] ??= {})
    for (const [p, intervals] of Object.entries(projects)) d[p] = Math.max(d[p] ?? 0, total(intervals))
  }
  return out
}

/** Time worked per project over the days. */
export function projectTotals(days: Readonly<Record<string, DayTotals>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const projects of Object.values(days)) for (const [p, ms] of Object.entries(projects)) out[p] = (out[p] ?? 0) + ms
  return out
}

/** The days from `from` to `to`, both included. */
export const inPeriod = (days: Readonly<Record<string, DayTotals>>, [from, to]: readonly [string, string]) =>
  Object.fromEntries(Object.entries(days).filter(([d]) => d >= from && d <= to))

/** Each day's time worked in `folder` and every folder inside it, oldest first, days without time left out. */
export function folderDays(days: Readonly<Record<string, DayTotals>>, folder: string): [string, number][] {
  const inside = folder.endsWith('/') ? folder : `${folder}/`
  return Object.entries(days)
    .map(([d, projects]): [string, number] => [d, Object.entries(projects).reduce((n, [p, ms]) => (p === folder || p.startsWith(inside) ? n + ms : n), 0)])
    .filter(([, ms]) => ms > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
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
