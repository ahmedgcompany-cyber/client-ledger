import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry } from '../types'
import {
  addCommand,
  addFile,
  addUsage,
  amount,
  cleanClient,
  dayKey,
  emptyTotals,
  finish,
  fmtDuration,
  fmtTokens,
  monthKey,
  monthStart,
  newEntry,
  parseJsonl,
  slug,
  summarize,
  toCsv,
  toMarkdown,
  totalsOf,
  weekStart,
  type Billing,
} from './ledger'

const PANE = 'client-ledger'
const active = atom({ plugin: 'client-ledger', key: 'active' } as const, { client: null, paused: false })
const current = atom({ plugin: 'client-ledger', key: 'current' } as const, null)
const today = atom({ plugin: 'client-ledger', key: 'today' } as const, emptyTotals())
const summary = atom({ plugin: 'client-ledger', key: 'summary' } as const, [])

type Engine = EngineInterface

let lastEnd: number | null = null

async function ledgerDir($: Engine): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${home.replace(/\\/g, '/')}/.claude/client-ledger`
}

async function readText($: Engine, path: string): Promise<string> {
  try {
    return await $.fs.read(path)
  } catch {
    return ''
  }
}

/** Every entry in day files from `since` on. */
async function loadSince($: Engine, since: number): Promise<Entry[]> {
  const dir = await ledgerDir($)
  const files = await $.fs.list(dir).catch(() => [])
  const first = dayKey(since)
  const names = files
    .map(f => f.name)
    .filter(n => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n) && n.slice(0, 10) >= first)
  const texts = await Promise.all(names.map(n => readText($, `${dir}/${n}`)))
  return texts.flatMap(parseJsonl)
}

async function loadMonth($: Engine, month: string): Promise<Entry[]> {
  const dir = await ledgerDir($)
  const files = await $.fs.list(dir).catch(() => [])
  const names = files.map(f => f.name).filter(n => n.startsWith(`${month}-`) && n.endsWith('.jsonl'))
  const texts = await Promise.all(names.map(n => readText($, `${dir}/${n}`)))
  return texts.flatMap(parseJsonl)
}

async function appendEntry($: Engine, entry: Entry): Promise<void> {
  const path = `${await ledgerDir($)}/${dayKey(entry.start)}.jsonl`
  const before = await readText($, path)
  await $.fs.write(path, before + JSON.stringify(entry) + '\n')
}

async function refreshToday($: Engine): Promise<void> {
  const { client } = await read($, active)
  const now = await $.clock.now()
  const path = `${await ledgerDir($)}/${dayKey(now)}.jsonl`
  const mine = parseJsonl(await readText($, path)).filter(e => e.client === client)
  await update($, today, () => totalsOf(mine))
}

async function setClient($: Engine, client: string | null): Promise<void> {
  await update($, active, a => ({ ...a, client, paused: false }))
  await update($, current, () => null)
  const cwd = await $.session.cwd()
  const folders = ((await $.store.get('folders')) ?? {}) as Record<string, string>
  if (client === null) delete folders[cwd]
  else folders[cwd] = client
  await $.store.set('folders', folders)
  if (client !== null) {
    const clients = ((await $.store.get('clients')) ?? []) as string[]
    if (!clients.includes(client)) await $.store.set('clients', [...clients, client].sort())
  }
  await refreshToday($)
}

async function openLedger($: Engine): Promise<void> {
  const now = await $.clock.now()
  const entries = await loadSince($, Math.min(weekStart(now), monthStart(now)))
  await update($, summary, () => summarize(entries, now))
  await $.ui.open({ id: PANE, title: 'Client Ledger' })
}

export const register: Register = (on, options) => {
  const billing: Billing = {
    hourlyRate: Number(options.hourlyRate ?? 0),
    tokenRatePerMillion: Number(options.tokenRatePerMillion ?? 0),
    currency: String(options.currency ?? 'USD'),
  }
  const idleMinutes = Number(options.idleMinutes ?? 10)
  const exportDir = String(options.exportDir ?? '').trim() || 'ledger-exports'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'client',
      description: 'Set the client this work is billed to',
      argumentHint: '[name | off | pause | resume]',
    })
    await $.command.register({
      name: 'ledger',
      description: 'Show billed time per client, or export a client’s month',
      argumentHint: '[export [client] [YYYY-MM]]',
    })
    const { client } = await read($, active)
    if (client === null) {
      const folders = ((await $.store.get('folders')) ?? {}) as Record<string, string>
      const mapped = folders[await $.session.cwd()]
      if (mapped !== undefined) await update($, active, a => ({ ...a, client: mapped }))
    }
    await refreshToday($)

    return next(e)
  })

  on('command.run', { command: 'client' }, async ($, e) => {
    const arg = e.args.trim()
    const { client, paused } = await read($, active)

    if (arg === '') {
      const clients = ((await $.store.get('clients')) ?? []) as string[]
      const now = client === null ? 'No client set.' : `Billing ${client}${paused ? ' (paused)' : ''}.`
      const known = clients.length === 0 ? 'No clients yet: /client <name> adds one.' : `Clients: ${clients.join(', ')}`
      return { text: `${now}\n${known}` }
    }
    if (arg === 'off') {
      await setClient($, null)
      return { text: 'Stopped tracking. This folder is no longer tied to a client.' }
    }
    if (arg === 'pause' || arg === 'resume') {
      if (client === null) return { text: 'No client set: /client <name> first.' }
      await update($, active, a => ({ ...a, paused: arg === 'pause' }))
      return { text: arg === 'pause' ? `Paused billing ${client}.` : `Resumed billing ${client}.` }
    }

    const name = cleanClient(arg)
    await setClient($, name)
    return { text: `Billing ${name}. This folder will open as ${name} next time.` }
  })

  on('command.run', { command: 'ledger' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(w => w !== '')
    if (words[0] !== 'export') {
      await openLedger($)
      return { text: 'Client Ledger opened.' }
    }

    const rest = words.slice(1)
    const now = await $.clock.now()
    const month = rest.length > 0 && /^\d{4}-\d{2}$/.test(rest[rest.length - 1]!) ? rest.pop()! : monthKey(now)
    const client = rest.length > 0 ? cleanClient(rest.join(' ')) : (await read($, active)).client
    if (client === null) return { text: 'Which client? /ledger export <client> [YYYY-MM]' }

    const entries = await loadMonth($, month)
    if (!entries.some(x => x.client === client)) return { text: `No tracked work for ${client} in ${month}.` }

    const base = `${exportDir.replace(/\\/g, '/').replace(/\/$/, '')}/ledger-${slug(client)}-${month}`
    await $.fs.write(`${base}.md`, toMarkdown(entries, client, month, billing))
    await $.fs.write(`${base}.csv`, toCsv(entries, client, month, billing))
    return { text: `Exported ${client}, ${month}:\n${base}.md\n${base}.csv` }
  })

  on('prompt.submit', async ($, e, next) => {
    const { client, paused } = await read($, active)
    const isOwnTurn = e.turnId === undefined && !e.text.trimStart().startsWith('/')
    if (client !== null && !paused && isOwnTurn) {
      const now = await $.clock.now()
      await update($, current, () => newEntry(client, e.text, now, lastEnd, idleMinutes))
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if ((await read($, current)) === null || ran.deny !== undefined) return ran

    if ((e.tool === 'Edit' || e.tool === 'Write') && ran.isError !== true) {
      await update($, current, c => (c === null ? c : addFile(c, e.file_path)))
    } else if (e.tool === 'Bash') {
      await update($, current, c => (c === null ? c : addCommand(c, e.command, ran.isError !== true)))
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const entry = await read($, current)
    if (entry !== null) {
      const u = e.usage
      let done = u ? addUsage(entry, u.input_tokens + u.cache_creation_input_tokens, u.output_tokens, u.model) : entry
      if (e.agentId === undefined) {
        const now = await $.clock.now()
        done = finish(done, e.durationMs, now)
        lastEnd = now
        await update($, current, () => null)
        await appendEntry($, done)
        await refreshToday($)
      } else {
        await update($, current, () => done)
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { client, paused } = await read($, active)
    if (client === null || e.props.hasSurvey) return next(e)

    const t = await read($, today)
    const { Box, Button, Text } = $.ui.resolve(e)
    const money = billing.hourlyRate > 0 || billing.tokenRatePerMillion > 0
      ? ` · ${amount(t, billing).toFixed(2)} ${billing.currency}`
      : ''

    return (
      <Box>
        <Text color={paused ? undefined : 'green'} dimColor={paused}>
          {paused ? '○' : '●'} {client}
        </Text>
        <Text dimColor>
          {' '}· today {fmtDuration(t.ms)} · {fmtTokens(t.tokens)} tok · {t.tasks} tasks{money}{' '}
        </Text>
        <Button
          key="pause"
          label={paused ? 'Resume' : 'Pause'}
          dimColor
          onPress={() => update($, active, a => ({ ...a, paused: !a.paused }))}
        />
        <Button key="ledger" label="Ledger" dimColor onPress={() => openLedger($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const rows = await read($, summary)
    const { client } = await read($, active)

    return (
      <Box flexDirection="column">
        <Text bold>Client          Today      Week       Month      Billable</Text>
        {rows.length === 0 && <Text dimColor>No tracked work this month. Set a client with /client name.</Text>}
        {rows.map(r => (
          <Text color={r.client === client ? 'green' : undefined}>
            {r.client.padEnd(15).slice(0, 15)} {fmtDuration(r.today.ms).padEnd(10)} {fmtDuration(r.week.ms).padEnd(10)}{' '}
            {fmtDuration(r.month.ms).padEnd(10)} {amount(r.month, billing).toFixed(2)} {billing.currency}
          </Text>
        ))}
        <Text dimColor> </Text>
        <Text dimColor>/ledger export [client] [YYYY-MM] writes an invoice-ready log.</Text>
      </Box>
    )
  })
}
