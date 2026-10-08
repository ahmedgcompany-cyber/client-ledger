import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Entry } from '../types'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 3,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 3 },
    view: {},
  },
} as const

/** The world beneath the plugin: memory store, clock and env, a cwd, and files kept in a map. */
const world = (on: On) => {
  const files = new Map<string, string>()
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:/Users/test' })
  const clock = mock.clock(on, { now: new Date(2026, 9, 8, 10, 0).getTime() })
  on('session.cwd', () => ({ value: 'C:/work/acme' }))
  on('fs.read', ($, e) => (files.has(e.path) ? { value: files.get(e.path)! } : { deny: 'ENOENT' }))
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  return { files, clock }
}

test('/client sets the client, the band shows it and pauses it', async ($, on) => {
  world(on)

  const set = await $.command.run({ command: 'client', args: 'Acme Corp', ...RUN })
  expect(set.text).toContain('Billing Acme Corp')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'client-ledger', surface, ...BAND })
    expect(await ui.find({ text: /Acme Corp/ })).toBeDefined()
    await ui.press({ key: 'pause' })
    expect(await ui.find({ key: 'pause', text: 'Resume' })).toBeDefined()
    await ui.press({ key: 'pause' })
    await ui.unmount()
  }

  const status = await $.command.run({ command: 'client', args: '', ...RUN })
  expect(status.text).toContain('Clients: Acme Corp')

  const off = await $.command.run({ command: 'client', args: 'off', ...RUN })
  expect(off.text).toContain('Stopped tracking')
})

test('a prompt, an edit and a test run become one ledger entry with proof', async ($, on) => {
  const { files, clock } = world(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))

  await $.command.run({ command: 'client', args: 'Acme', ...RUN })
  await $.prompt.submit({ text: 'Add password reset', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Edit', tool_use_id: 't1', file_path: 'src/reset.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 't2', command: 'npm test' })
  await clock.advance(20 * 60_000)
  await $.turn.complete({
    answer: 'Done.',
    durationMs: 20 * 60_000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
    usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' },
  })

  const day = [...files].find(([path]) => path.replace(/\\/g, '/').endsWith('/.claude/client-ledger/2026-10-08.jsonl'))?.[1]
  expect(day).toBeDefined()
  const entry = JSON.parse(day!.trim()) as Entry
  expect(entry.client).toBe('Acme')
  expect(entry.task).toBe('Add password reset')
  expect(entry.files).toEqual(['src/reset.ts'])
  expect(entry.commands).toEqual([{ cmd: 'npm test', ok: true }])
  expect(entry.tokensIn + entry.tokensOut).toBe(1500)
  expect(entry.aiMs).toBe(20 * 60_000)
})
