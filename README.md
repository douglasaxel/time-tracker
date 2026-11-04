# time-tracker

A Claude Code mod that measures the time worked on each project, on its own, and shows today's time in the status line:

```
⏱ 2h 14min hoje · app-a
```

Time counts while Claude answers, while the session's background work runs, and across short pauses between interactions; a gap longer than the inactivity limit does not count. Background work counts while a turn's end lists it in flight within the inactivity limit, or while a subagent of the session runs. Each session records its own intervals per project and local day in the plugin store (`session:<id>`); sessions open at the same time in one project count the period once. Once a day is closed, it is compacted into one total per project (`day:<YYYY-MM-DD>`) and the old session keys are removed.

The project is the session's project root: after a `/cd`, new time goes to the new folder. A session in a git worktree counts for the original repository, whether the worktree's `gitdir` is absolute or relative.

The status line shows the same time as the panel for today's project, corrections included.

## The /horas panel

`/horas` opens and closes a panel. It opens on this week's timesheet: projects in the rows, the days in the columns, a total per project and per day, and a stronger blue the more time a cell holds. Each project reads its last folder name; two with the same name also show their parent. The arrows walk to earlier periods, up to the current one.

The filters (Today, Week from Monday to Sunday, Month, All; in Portuguese Hoje, Semana, Mês, Tudo) set the period and the columns: a day or a week shows days, a month shows its weeks, and All shows the last 8 months with older ones joined in one column. Pressing the period at the top, or **Dates**, opens a calendar: the first press starts the period and the second ends it, an earlier day starts it again, and pressing the month picks all of it. A picked period shows days up to 8 days, weeks up to 70 days, and months beyond that. Time is split by local day: an activity that crosses midnight counts its part on each day.

**Folders** switches to the tree from the disk root down to each project with time. Single-child folders without time of their own fold into one node, each folder shows its folder total (its own time plus that of the folders inside it), and a small toggle (`▾`/`▸`) before each folder collapses and expands it. Windows paths read with backslashes (`C:\Users\dougl\workstation`). Pressing a folder's name or time narrows the timesheet to it; **All folders** takes that off.

On a graphical surface the timesheet is one drawing, which takes no press, so **Correct hours** under it opens the list of days. Pressing a project's time on a day opens its correction: type minutes to add or subtract (`+15`, `-30`) or press **Delete this day** to zero it for good, time measured later that day included; an adjustment after a deletion adds from zero (mobile has the delete only). The time shown everywhere is the measured time plus the corrections, never below zero, and a corrected day is marked `*`, in its timesheet cell too. Corrections are kept per day under `fix:<YYYY-MM-DD>`, apart from the measured time, so compaction leaves them alone: per project, the ms added, or `{ "deleted": true, "ms": <ms added after the deletion> }`.

Under the days, **Copy as Markdown** copies what they show as a table for an hours report: a title with the folder and the period, columns Date (with the year) | Project | Hours (the project relative to the folder), one row per day and project, a Total row, and `*` with a footnote on corrected rows. Hours read `Xh MMmin`, never rounded. If the clipboard does not take it (some desktops), the pane shows the table to copy by hand.

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
