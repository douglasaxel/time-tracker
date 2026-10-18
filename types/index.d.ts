/** Epoch ms, start and end of one stretch of activity, inside one local day. */
export type Interval = [number, number]

/** Day key `YYYY-MM-DD` (local) -> project path -> intervals, sorted and disjoint. */
export type Days = Record<string, Record<string, Interval[]>>

/** What a session writes to `$.store` under `session:<sessionId>`. */
export type SessionRecord = { days: Days }

/** What `$.store` holds under `day:<YYYY-MM-DD>` for a closed day: project path -> ms worked, all sessions united. */
export type DayTotals = Record<string, number>

/**
 * One project day's correction: ms added to the measured time (negative subtracts), or the day
 * deleted, so measured time no longer counts, with `ms` added from zero after the deletion.
 */
export type Correction = number | { deleted: true; ms: number }

/** Corrections, as the `fix:<YYYY-MM-DD>` keys hold them: day -> project path -> correction. */
export type Corrections = Record<string, Record<string, Correction>>

/** The project day a correction applies to. */
export type CorrectionTarget = { day: string; project: string }

/** The activity in progress: from `start` to the last active instant `last`. */
export type Live = { project: string; start: number; last: number }

/** The session's own measurement, held for the session in `$.state`. */
export type SessionMeasurement = {
  /** The session id the measurement belongs to; null after a /clear until the next activity. */
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
      measurement: SessionMeasurement
      /** When the last classic.Stop listed background work of the session in flight; null when none. */
      backgroundSince: number | null
      /** Folder paths collapsed in the /horas panel. */
      collapsed: string[]
      /** The /horas panel's period. */
      filter: Filter
      /** The folder whose days the /horas panel lists, if any. */
      selected: string | null
      /** Manual pause of this session: while on, no activity is recorded. */
      paused: boolean
      /** Every session's corrections, read from the store. */
      corrections: Corrections
      /** The project day whose correction line is open. */
      correcting: CorrectionTarget | null
      /** The last Copy as Markdown: whether the clipboard took it, and the table copied. */
      copy: { ok: boolean; text: string } | null
    }
  }
}
