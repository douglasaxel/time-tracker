/** Epoch ms, start and end of one stretch of activity, inside one local day. */
export type Interval = [number, number]

/** Day key `YYYY-MM-DD` (local) -> project path -> intervals, sorted and disjoint. */
export type Days = Record<string, Record<string, Interval[]>>

/** What a session writes to `$.store` under `session:<sessionId>`. */
export type SessionRecord = { days: Days }

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

declare module 'claude-code' {
  interface PluginState {
    'time-tracker': { rec: Rec; background: boolean }
  }
}
