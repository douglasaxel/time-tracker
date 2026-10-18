# time-tracker

A Claude Code mod that measures the time worked on each project, on its own, and shows today's time in the status line:

```
⏱ 2h 14min hoje · app-a
```

Time counts while Claude answers, while the session's background work runs, and across short pauses between interactions; a gap longer than the inactivity limit does not count. Background work counts while a turn's end lists it in flight within the inactivity limit, or while a subagent of the session runs. Each session records its own intervals per project and local day in the plugin store (`session:<id>`); sessions open at the same time in one project count the period once. Once a day is closed, it is compacted into one total per project (`day:<YYYY-MM-DD>`) and the old session keys are removed.

The project is the session's project root: after a `/cd`, new time goes to the new folder. A session in a git worktree counts for the original repository, whether the worktree's `gitdir` is absolute or relative.

The status line shows the same time as the panel for today's project, corrections included.

## The /horas panel

`/horas` opens and closes a panel with the tree of folders from the disk root down to each project with time. Single-child folders without time of their own fold into one node, each folder shows its folder total (its own time plus that of the folders inside it), and a small toggle (`▾`/`▸`) before each folder collapses and expands it. Windows paths read with backslashes (`C:\Users\dougl\workstation`).

Time is split by local day: an activity that crosses midnight counts its part on each day. The filters at the top (Today, Week from Monday to Sunday, Month, All; in Portuguese Hoje, Semana, Mês, Tudo; keys 1 to 4 while the panel has the focus) set the period the tree and the totals cover. Pressing a folder's name selects it, opens it and lists its days in the period with each day's time. Pressing its time selects it too, and pressing the selected folder's time again clears the selection.

Each day lists the time of each project inside the selected folder. Pressing a project's time on a day opens its correction: type minutes to add or subtract (`+15`, `-30`) or press **Delete this day** to zero it for good, time measured later that day included; an adjustment after a deletion adds from zero (mobile has the delete only). The time shown everywhere is the measured time plus the corrections, never below zero, and a corrected day is marked `*`. Corrections are kept per day under `fix:<YYYY-MM-DD>`, apart from the measured time, so compaction leaves them alone: per project, the ms added, or `{ "deleted": true, "ms": <ms added after the deletion> }`.

Under the selected folder, **Copy as Markdown** copies its days in the period as a table for an hours report: a title with the folder and the period, columns Date (with the year) | Project | Hours (the project relative to the folder), one row per day and project, a Total row, and `*` with a footnote on corrected rows. Hours read `Xh MMmin`, never rounded. If the clipboard does not take it (some desktops), the pane shows the table to copy by hand.

At the top, **Pause** stops the count for the current session until **Resume**; other sessions keep counting. While paused the status line shows `⏸` instead of `⏱`.

## Install

```
/plugin install time-tracker --marketplace douglasaxel/time-tracker
```

## Options (`/config`)

- **Inactivity limit (minutes)**: the longest gap that still counts as time worked. Default 10.
- **Language**: `auto` (Claude Code's language setting, then the system locale), `en` or `pt`.

## Development

```
claude plugin validate .
claude plugin test .
```

The function hooks API is early access and may change between Claude Code versions.
