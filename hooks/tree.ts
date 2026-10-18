// The tree: folders from the disk root down to each project with time, single-child
// folders without time of their own folded into one node. Paths and their names. Pure.
import type { Corrections, DayTotals, Days } from '../types'
import { isCorrected } from './corrections'
import { merge } from './ledger'
import { total } from './time'

export type Node = {
  /** The folder's path, `/`-separated: the key that selects and collapses it. */
  path: string
  /** What the row shows: the folder's name, or the folded run of names, `/`-separated. */
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

/** A path from the engine as the mod keeps paths: `/` separators, no trailing one. */
export function toSlashes(path: string): string {
  const s = path.trim().split('\\').join('/')
  return s.length > 3 ? s.replace(/\/+$/, '') : s
}

/** `path` resolved against the folder `base` when it is relative, `.` and `..` worked out; both `/`-separated. */
export function resolvePath(base: string, path: string): string {
  const joined = /^([a-z]:)?\//i.test(path) ? path : `${base}/${path}`
  const out: string[] = []
  for (const part of joined.split('/')) {
    if (part === '..') {
      if (out.length > 1) out.pop()
    } else if (part !== '.' && (part || !out.length)) out.push(part)
  }
  return out.join('/')
}

/** How the panel shows `text`, a part of `path`: with backslashes when `path` is a Windows path. */
export const displayPath = (text: string, path: string) => (/^[a-z]:/i.test(path) ? text.split('/').join('\\') : text)

const withSlash = (folder: string) => (folder.endsWith('/') ? folder : `${folder}/`)

/** The last name in a path: what the status line and the copied table call a project or folder. */
export const folderName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

/** How a row inside `folder` names `project`: its path relative to the folder, or the folder's name. */
export const relativeName = (project: string, folder: string) =>
  project === folder ? folderName(folder) : project.slice(withSlash(folder).length)

/** One project's time on one day, inside the selected folder; `corrected` marks a correction. */
export type Entry = { project: string; ms: number; corrected: boolean }
export type FolderDay = { day: string; total: number; corrected: boolean; entries: Entry[] }

/**
 * Each day in `folder` and every folder inside it, oldest first, with each project's time on it
 * (corrections applied). Days and projects without time are left out unless corrected.
 */
export function folderDays(days: Readonly<Record<string, DayTotals>>, folder: string, corrections: Readonly<Corrections> = {}): FolderDay[] {
  const inside = withSlash(folder)
  return Object.entries(days)
    .map(([day, projects]): FolderDay => {
      const entries = Object.entries(projects)
        .filter(([p]) => p === folder || p.startsWith(inside))
        .map(([project, ms]) => ({ project, ms, corrected: isCorrected(corrections, { day, project }) }))
        .filter(e => e.ms > 0 || e.corrected)
        .sort((a, b) => a.project.localeCompare(b.project))
      return { day, total: entries.reduce((n, e) => n + e.ms, 0), corrected: entries.some(e => e.corrected), entries }
    })
    .filter(d => d.entries.length)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
}

/** A folder while the tree is built: its own time, and the folders inside it by name. */
type DraftFolder = { path: string; name: string; own: number; children: Map<string, DraftFolder> }

const byName = (a: Node, b: Node) => a.name.localeCompare(b.name)

const folderTotal = (n: DraftFolder): number => [...n.children.values()].reduce((t, c) => t + folderTotal(c), n.own)

function foldSingleChildFolders(n: DraftFolder): Node {
  while (n.own === 0 && n.children.size === 1) {
    const onlyChild = n.children.values().next().value as DraftFolder
    n = { ...onlyChild, name: `${n.name}/${onlyChild.name}` }
  }
  const children = [...n.children.values()].map(foldSingleChildFolders).sort(byName)
  return { path: n.path, name: n.name, total: folderTotal(n), children }
}

/** The roots of the tree (one per disk), folders without time left out. */
export function buildTree(totals: Record<string, number>): Node[] {
  const top: DraftFolder = { path: '', name: '', own: 0, children: new Map() }
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
  return [...top.children.values()].map(foldSingleChildFolders).sort(byName)
}
