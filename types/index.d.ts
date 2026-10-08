/** One prompt's worth of work, attributed to a client. */
export type Entry = {
  id: string
  client: string
  /** Prompt submitted, ms since epoch. */
  start: number
  /** Turn finished, ms since epoch. */
  end: number
  /** Time Claude spent working on the turn. */
  aiMs: number
  /** Your own time before the prompt (reviewing, typing), capped by the idle setting. */
  humanMs: number
  tokensIn: number
  tokensOut: number
  model?: string
  /** First line of the prompt, cut to 200 characters. */
  task: string
  files: string[]
  commands: { cmd: string; ok: boolean }[]
}

export type Totals = { ms: number; tokens: number; tasks: number }

export type ClientSummary = {
  client: string
  today: Totals
  week: Totals
  month: Totals
}

export type Active = { client: string | null; paused: boolean }

declare module 'claude-code' {
  interface PluginState {
    'client-ledger': {
      active: Active
      current: Entry | null
      today: Totals
      summary: ClientSummary[]
    }
  }
}
