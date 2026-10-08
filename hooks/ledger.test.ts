import { describe, expect, test } from 'claude-code/testing'

import {
  addCommand,
  addFile,
  addUsage,
  amount,
  finish,
  fmtDuration,
  newEntry,
  parseJsonl,
  summarize,
  toCsv,
  toMarkdown,
} from './ledger'

const T0 = new Date(2026, 9, 8, 10, 0).getTime()
const MIN = 60_000
const billing = { hourlyRate: 100, tokenRatePerMillion: 10, currency: 'USD' }

const work = (client: string, start: number) => {
  let e = newEntry(client, 'Fix the login bug\nmore detail', start, null, 10)
  e = addFile(e, 'src/login.ts')
  e = addFile(e, 'src/login.ts')
  e = addCommand(e, 'npm test', true)
  e = addUsage(e, 400_000, 100_000, 'claude-opus-5-5')
  return finish(e, 30 * MIN, start + 30 * MIN)
}

describe('entries', () => {
  test('caps your own time at the idle limit', async () => {
    expect(newEntry('acme', 'x', T0, T0 - 5 * MIN, 10).humanMs).toBe(5 * MIN)
    expect(newEntry('acme', 'x', T0, T0 - 90 * MIN, 10).humanMs).toBe(10 * MIN)
    expect(newEntry('acme', 'x', T0, null, 10).humanMs).toBe(0)
  })

  test('records the task line, each file once, commands and tokens', async () => {
    const e = work('acme', T0)
    expect(e.task).toBe('Fix the login bug')
    expect(e.files).toEqual(['src/login.ts'])
    expect(e.commands).toEqual([{ cmd: 'npm test', ok: true }])
    expect(e.tokensIn + e.tokensOut).toBe(500_000)
    expect(e.aiMs).toBe(30 * MIN)
  })

  test('reads JSONL back, skipping broken lines', async () => {
    const e = work('acme', T0)
    expect(parseJsonl(`${JSON.stringify(e)}\nnot json\n\n`)).toEqual([e])
  })
})

describe('totals and billing', () => {
  test('summarizes per client, busiest first', async () => {
    const rows = summarize([work('acme', T0), work('acme', T0 + 60 * MIN), work('globex', T0)], T0 + 120 * MIN)
    expect(rows.map(r => r.client)).toEqual(['acme', 'globex'])
    expect(rows[0]!.today.tasks).toBe(2)
    expect(rows[0]!.month.ms).toBe(60 * MIN)
  })

  test('prices hours plus tokens', async () => {
    // 0.5 h × 100 + 0.5M tokens × 10 = 55
    expect(amount({ ms: 30 * MIN, tokens: 500_000, tasks: 1 }, billing)).toBe(55)
    expect(fmtDuration(75 * MIN)).toBe('1h 15m')
  })
})

describe('exports', () => {
  test('markdown log carries totals and proof for one client and month', async () => {
    const md = toMarkdown([work('acme', T0), work('globex', T0)], 'acme', '2026-10', billing)
    expect(md).toContain('# Work log: acme, 2026-10')
    expect(md).toContain('55.00 USD')
    expect(md).toContain('- changed `src/login.ts`')
    expect(md).toContain('- ran `npm test`')
    expect(md).not.toContain('globex')
  })

  test('csv quotes cells with commas', async () => {
    let e = work('acme', T0)
    e = { ...e, task: 'Fix a, b' }
    const csv = toCsv([e], 'acme', '2026-10', billing)
    expect(csv.split('\n')[0]).toContain('date,start,end,hours')
    expect(csv).toContain('"Fix a, b"')
  })
})
