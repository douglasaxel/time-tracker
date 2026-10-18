// The status line text: `⏱ <time today> today · <project folder>`, `⏸` while paused. Pure.
import { strings, type Lang } from './i18n'
import { formatDuration } from './time'
import { folderName } from './tree'

/** `today` is the project's time shown for today: every session's, corrections applied, as the panel shows it. */
export const statusText = (today: number, project: string, lang: Lang, paused: boolean) =>
  `${paused ? '⏸' : '⏱'} ${formatDuration(today)} ${strings[lang].today} · ${folderName(project)}`
