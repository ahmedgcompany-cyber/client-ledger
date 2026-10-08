import type { ClientSummary, Entry, Totals } from '../types'

const DAY_MS = 86_400_000

export type Billing = { hourlyRate: number; tokenRatePerMillion: number; currency: string }

export const pad = (n: number): string => String(n).padStart(2, '0')

/** Local calendar day, `YYYY-MM-DD`: the name of that day's ledger file. */
export const dayKey = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const monthKey = (ms: number): string => dayKey(ms).slice(0, 7)

/** Start of the local day / Monday-based week / month that holds `ms`. */
export const dayStart = (ms: number): number => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
export const weekStart = (ms: number): number => {
  const day = (new Date(ms).getDay() + 6) % 7
  return dayStart(ms) - day * DAY_MS
}
export const monthStart = (ms: number): number => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

/** Normalises a client name typed by the person: trimmed, inner spaces collapsed. */
export const cleanClient = (raw: string): string => raw.trim().replace(/\s+/g, ' ').slice(0, 60)

export const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client'

export const newEntry = (
  client: string,
  prompt: string,
  now: number,
  lastEnd: number | null,
  idleMinutes: number,
): Entry => {
  const gap = lastEnd === null ? 0 : Math.max(0, now - lastEnd)
  const firstLine = prompt.trim().split('\n')[0] ?? ''
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    client,
    start: now,
    end: now,
    aiMs: 0,
    humanMs: Math.min(gap, idleMinutes * 60_000),
    tokensIn: 0,
    tokensOut: 0,
    task: firstLine.slice(0, 200),
    files: [],
    commands: [],
  }
}

export const addFile = (entry: Entry, path: string): Entry =>
  entry.files.includes(path) ? entry : { ...entry, files: [...entry.files, path].slice(-100) }

export const addCommand = (entry: Entry, cmd: string, ok: boolean): Entry => ({
  ...entry,
  commands: [...entry.commands, { cmd: cmd.trim().split('\n')[0]!.slice(0, 160), ok }].slice(-100),
})

export const addUsage = (entry: Entry, tokensIn: number, tokensOut: number, model?: string): Entry => ({
  ...entry,
  tokensIn: entry.tokensIn + tokensIn,
  tokensOut: entry.tokensOut + tokensOut,
  model: model ?? entry.model,
})

export const finish = (entry: Entry, aiMs: number, now: number): Entry => ({
  ...entry,
  aiMs: entry.aiMs + aiMs,
  end: now,
})

export const entryMs = (e: Entry): number => e.aiMs + e.humanMs
export const entryTokens = (e: Entry): number => e.tokensIn + e.tokensOut

export const emptyTotals = (): Totals => ({ ms: 0, tokens: 0, tasks: 0 })

export const addToTotals = (t: Totals, e: Entry): Totals => ({
  ms: t.ms + entryMs(e),
  tokens: t.tokens + entryTokens(e),
  tasks: t.tasks + 1,
})

export const totalsOf = (entries: readonly Entry[]): Totals => entries.reduce(addToTotals, emptyTotals())

/** Per-client totals for today, this week and this month, busiest month first. */
export const summarize = (entries: readonly Entry[], now: number): ClientSummary[] => {
  const d = dayStart(now)
  const w = weekStart(now)
  const m = monthStart(now)
  const by = new Map<string, ClientSummary>()
  for (const e of entries) {
    if (e.start < m) continue
    const s = by.get(e.client) ?? { client: e.client, today: emptyTotals(), week: emptyTotals(), month: emptyTotals() }
    s.month = addToTotals(s.month, e)
    if (e.start >= w) s.week = addToTotals(s.week, e)
    if (e.start >= d) s.today = addToTotals(s.today, e)
    by.set(e.client, s)
  }
  return [...by.values()].sort((a, b) => b.month.ms - a.month.ms)
}

export const parseJsonl = (text: string): Entry[] =>
  text
    .split('\n')
    .filter(line => line.trim() !== '')
    .flatMap(line => {
      try {
        return [JSON.parse(line) as Entry]
      } catch {
        return []
      }
    })

export const fmtDuration = (ms: number): string => {
  const mins = Math.round(ms / 60_000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`
}

export const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

export const hours = (ms: number): number => Math.round((ms / 3_600_000) * 100) / 100

export const amount = (t: Totals, b: Billing): number =>
  Math.round((hours(t.ms) * b.hourlyRate + (t.tokens / 1_000_000) * b.tokenRatePerMillion) * 100) / 100

const fmtTime = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Invoice-ready work log for one client and month, newest last. */
export const toMarkdown = (entries: readonly Entry[], client: string, month: string, b: Billing): string => {
  const mine = entries.filter(e => e.client === client && monthKey(e.start) === month).sort((x, y) => x.start - y.start)
  const t = totalsOf(mine)
  const lines: string[] = [
    `# Work log: ${client}, ${month}`,
    '',
    `| Tasks | Time | Hours | Tokens | Amount |`,
    `| --- | --- | --- | --- | --- |`,
    `| ${t.tasks} | ${fmtDuration(t.ms)} | ${hours(t.ms)} | ${fmtTokens(t.tokens)} | ${amount(t, b).toFixed(2)} ${b.currency} |`,
    '',
  ]
  if (b.hourlyRate > 0 || b.tokenRatePerMillion > 0) {
    lines.push(
      `Rates: ${b.hourlyRate} ${b.currency}/hour` +
        (b.tokenRatePerMillion > 0 ? `, ${b.tokenRatePerMillion} ${b.currency} per million tokens` : ''),
      '',
    )
  }
  let day = ''
  for (const e of mine) {
    const dk = dayKey(e.start)
    if (dk !== day) {
      day = dk
      lines.push(`## ${dk}`, '')
    }
    lines.push(`### ${fmtTime(e.start)} · ${fmtDuration(entryMs(e))} · ${e.task || '(no description)'}`)
    for (const f of e.files) lines.push(`- changed \`${f}\``)
    for (const c of e.commands) lines.push(`- ran \`${c.cmd}\`${c.ok ? '' : ' (failed)'}`)
    lines.push('')
  }
  if (mine.length === 0) lines.push('_No tracked work this month._', '')
  return lines.join('\n')
}

const csvCell = (v: string | number): string => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCsv = (entries: readonly Entry[], client: string, month: string, b: Billing): string => {
  const header = ['date', 'start', 'end', 'hours', 'ai_minutes', 'human_minutes', 'tokens', 'amount', 'currency', 'task', 'files', 'commands']
  const rows = entries
    .filter(e => e.client === client && monthKey(e.start) === month)
    .sort((x, y) => x.start - y.start)
    .map(e => {
      const t = addToTotals(emptyTotals(), e)
      return [
        dayKey(e.start),
        fmtTime(e.start),
        fmtTime(e.end),
        hours(t.ms),
        Math.round(e.aiMs / 60_000),
        Math.round(e.humanMs / 60_000),
        t.tokens,
        amount(t, b).toFixed(2),
        b.currency,
        e.task,
        e.files.join(' '),
        e.commands.map(c => c.cmd).join(' ; '),
      ].map(csvCell).join(',')
    })
  return [header.join(','), ...rows].join('\n') + '\n'
}
