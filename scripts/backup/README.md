# Database backups

**What:** weekly `pg_dump` of the Neon database to `OneDrive\JournalBackups` (synced off the PC).
- `journal_*.dump`: every table except market bars (~4 MB). Every Sunday 10:00, newest 8 kept.
- `bars_*.dump`: `bars_1m` (~21 MB). Only when new bars arrived and the last one is 28+ days old. Newest 2 kept.
- `scan_cache` is not backed up (the server rebuilds it from `bars_1m`).
- Neon transfer per month: about 4 x 50 MB journal + 1 x 100 MB bars, roughly 6% of the free 5 GB.

**Schedule:** Windows Task Scheduler "Journal DB backup" (Sunday 10:00, runs at the next start-up if the PC was off).

**Check it worked:** `OneDrive\JournalBackups\LAST_OK.txt` (date of the last good run) and `backup.log`.
A failure writes `LAST_FAILED.txt` with the reason.

## One-time setup (Kay)
The task needs the database URL, stored encrypted for your Windows user (DPAPI, never in plain text):
```
powershell -ExecutionPolicy Bypass -File C:\Users\wolfm\trading-journal\scripts\backup\set-db-url.ps1
```
Paste the URL from Render, Environment, DATABASE_URL. Run it again after rotating the Neon password.

## Run now
```
powershell -ExecutionPolicy Bypass -File C:\Users\wolfm\trading-journal\scripts\backup\backup.ps1 [-ForceBars]
```

## Restore (into an EMPTY database: a new Neon database or local Postgres)
```
powershell -ExecutionPolicy Bypass -File C:\Users\wolfm\trading-journal\scripts\backup\restore.ps1 -Target "postgresql://user:pass@host/emptydb"
```
It loads the newest journal and bars files (or pass `-Journal`/`-Bars`, or `-NoBars`). Neon-only column
options (`pg_attver`) are stripped so standard Postgres accepts the dump. Then set DATABASE_URL on Render
to the new database and restart.

Tested 2026-11-19: a full restore into local Postgres 18 matched the live database exactly (46 accounts,
44,559 trades, 1,770,120 bars, md5 of all trade notes, playbook JSON, drawings, accounts, attempts, notes).
