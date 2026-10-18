# time-tracker

A Claude Code mod that measures the time worked on each project, on its own, and shows today's time in the status line:

```
⏱ 2h 14min hoje · app-a
```

Time counts while Claude answers and across short pauses between interactions; a gap longer than the idle limit does not count. Each session records its own intervals per project and local day in the plugin store (`session:<id>`); sessions open at the same time in one project count the period once. Once a day is closed, it is compacted into one total per project (`day:<YYYY-MM-DD>`) and the old session keys are removed.

The project is the session's project root: after a `/cd`, new time goes to the new folder. A session in a git worktree counts for the main repository.

## The /horas panel

`/horas` opens and closes a panel with the tree of folders from the disk root down to each project with time. Single-child folders without time of their own fold into one node, each folder shows its folder total (its own time plus that of the folders inside it), and folders open and close with a press.

Time is split by local day: an activity that crosses midnight counts its part on each day. The filters at the top (Today, Week from Monday to Sunday, Month, All; keys 1 to 4 while the panel has the focus) set the period the tree and the totals cover. Pressing a folder's time selects it and lists its days in the period with each day's time; pressing it again clears the selection.

At the top, **Pause** stops the count for the current session until **Resume**; other sessions keep counting. While paused the status line shows `⏸` instead of `⏱`.

## Install

```
/plugin install time-tracker --marketplace douglasaxel/time-tracker
```

## Options (`/config`)

- **Idle limit (minutes)**: the longest gap that still counts as time worked. Default 10.
- **Language**: `auto` (Claude Code's language setting, then the system locale), `en` or `pt`.

## Development

```
claude plugin validate .
claude plugin test .
```

The function hooks API is early access and may change between Claude Code versions.
