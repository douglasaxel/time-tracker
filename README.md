# time-tracker

A Claude Code mod that measures the time worked on each project, on its own, and shows today's time in the status line:

```
⏱ 2h 14min hoje · app-a
```

Time counts while Claude answers and across short pauses between interactions; a gap longer than the idle limit does not count. Each session records its own intervals per project and local day in the plugin store.

## The /horas panel

`/horas` opens and closes a panel with the tree of folders from the disk root down to each project with time. Single-child folders without time of their own fold into one node, each folder shows its folder total (its own time plus that of the folders inside it), and folders open and close with a press.

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
