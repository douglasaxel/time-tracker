/** Epoch ms, start and end of one stretch of activity, inside one local day. */
export type Interval = [number, number]

/** Day key `YYYY-MM-DD` (local) -> project path -> intervals, sorted and disjoint. */
export type Days = Record<string, Record<string, Interval[]>>

/** What a session writes to `$.store` under `session:<sessionId>`. */
export type SessionRecord = { days: Days }

/** What `$.store` holds under `day:<YYYY-MM-DD>` for a closed day: project path -> ms worked, all sessions united. */
export type DayTotals = Record<string, number>

/** Corrections (#9), as the `fix:<YYYY-MM-DD>` keys hold them: day -> project path -> ms added (negative subtracts). */
export type Fixes = Record<string, DayTotals>

/** The activity in progress: from `start` to the last active instant `last`. */
export type Live = { project: string; start: number; last: number }

/** The session's own measurement, held for the session in `$.state`. */
export type Rec = {
  /** The session id the record belongs to; null after a /clear until the next activity. */
  id: string | null
  /** Closed intervals of this session. */
  days: Days
  live: Live | null
  /** Turns running now (main loop and subagents): while any runs, the session is active. */
  turns: string[]
}

/** The /horas panel's period: today, this week (Monday to Sunday), this month, or every day. */
export type Filter = 'today' | 'week' | 'month' | 'all'

declare module 'claude-code' {
  interface PluginState {
    'time-tracker': {
      rec: Rec
      background: boolean
      /** Folder paths collapsed in the /horas panel. */
      collapsed: string[]
      /** The /horas panel's period (#5). */
      filter: Filter
      /** The folder whose days the /horas panel lists, if any (#5). */
      selected: string | null
      /** Manual pause of this session (#8): while on, no activity is recorded. */
      paused: boolean
      /** Every session's corrections (#9), read from the store. */
      fixes: Fixes
      /** The project day whose correction line is open, `<YYYY-MM-DD>|<project>` (#9). */
      fixing: string | null
      /** The last Copy as Markdown (#10): whether the clipboard took it, and the table copied. */
      copy: { ok: boolean; text: string } | null
    }
  }
}
