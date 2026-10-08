# Client Ledger

A Claude Code mod for freelancers and agencies: it bills your Claude Code work to clients.

It records which client each task was for, how long it took, how many tokens it used and what was done (files changed, commands run). Then it exports an invoice-ready work log per client and month.

## What it does

- **Client tagging**: `/client Acme` sets who you're billing. The folder is remembered, so the next session there starts as Acme. `/client pause`, `/client resume` and `/client off` also work, and `/client` alone lists your clients.
- **Time and token meter**: each prompt is one task. It counts Claude's working time plus your own time between prompts, capped by an idle limit, and the tokens the turn used, subagents included.
- **Proof of work**: every task keeps the prompt's first line, each file Claude edited or wrote, and each shell command with pass or fail.
- **Live band**: a row above the prompt shows `● Acme · today 1h 05m · 84k tok · 3 tasks · 108.00 USD`, with **Pause** and **Ledger** buttons.
- **Ledger pane**: `/ledger` shows per-client totals for today, this week and this month, with the billable amount.
- **Exports**: `/ledger export [client] [YYYY-MM]` writes `ledger-<client>-<month>.md` (a dated task list with hours, amount and proof) and a matching `.csv` for spreadsheets and accounting tools.

## Install

You need Claude Code 2.1.287 or later (mods support).

```bash
git clone https://github.com/ahmedgcompany-cyber/client-ledger
claude --plugin-dir ./client-ledger
```

Or add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (`env` block) to load it in every session, the desktop app included.

## Settings

These are set in `/config`, or under `pluginConfigs.client-ledger.options` in settings.

| Setting | Default | Meaning |
| --- | --- | --- |
| `hourlyRate` | 0 | What you bill per tracked hour |
| `currency` | USD | Currency code on exports |
| `tokenRatePerMillion` | 0 | What you bill per million tokens, on top of hours |
| `idleMinutes` | 10 | Gaps between prompts count at most this long as your own time |
| `exportDir` | `ledger-exports` | Where exports are written |

## Data

Entries are saved as JSON lines, one file per day, in `~/.claude/client-ledger/YYYY-MM-DD.jsonl`. Nothing leaves your machine.

## Limits

- "Your time" is an estimate: the gap since Claude's last answer, capped by `idleMinutes`.
- Proof covers the Edit, Write and Bash tools.
- The mod API is early access, so a Claude Code update may need a mod update.

## Development

```bash
claude plugin validate .
claude plugin test .
```

## License

MIT
