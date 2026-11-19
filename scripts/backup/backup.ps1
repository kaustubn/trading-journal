# Weekly backup of the trading journal database (Neon) with pg_dump 18.
# - Journal tables (trades, accounts, notes, playbooks, settings...): every run.
# - Market bars (bars_1m, ~1.8M rows): only when new bars arrived AND the last bars dump is 28+ days old,
#   to keep Neon's 5 GB/month transfer small (journal ~50 MB, bars ~100 MB per dump).
# - scan_cache is skipped (rebuilt automatically from bars_1m).
# Files go to OneDrive\JournalBackups (synced off this PC). Keeps the newest 8 journal and 2 bars dumps.
# The database URL is read from an encrypted file only this Windows user can decrypt (set-db-url.ps1).
# Usage: powershell -ExecutionPolicy Bypass -File backup.ps1 [-ForceBars]
param([switch]$ForceBars)
$ErrorActionPreference = 'Stop'

$PgBin   = 'C:\Program Files\PostgreSQL\18\bin'
$SecFile = Join-Path $env:LOCALAPPDATA 'JournalBackup\dburl.sec'
$Dest    = Join-Path $env:USERPROFILE 'OneDrive\JournalBackups'
if (-not (Test-Path (Split-Path $Dest))) { $Dest = Join-Path $PSScriptRoot '..\..\backups' }
$State   = Join-Path $Dest 'state.json'
$Log     = Join-Path $Dest 'backup.log'
New-Item -ItemType Directory -Force $Dest | Out-Null

function Write-Log($msg) {
  $line = "[{0:yyyy-MM-dd HH:mm}] {1}" -f (Get-Date), $msg
  Add-Content -Path $Log -Value $line -Encoding utf8
  Write-Output $line
}

try {
  if ($env:JOURNAL_DB_URL) {
    $url = $env:JOURNAL_DB_URL                    # one-off runs: URL passed in memory, nothing stored
  } elseif (Test-Path $SecFile) {
    $sec = Get-Content $SecFile | ConvertTo-SecureString
    $url = [System.Net.NetworkCredential]::new('', $sec).Password
  } else { throw "No saved database URL. Run scripts\backup\set-db-url.ps1 first." }
  $url = $url -replace '-pooler\.', '.'          # pg_dump needs Neon's direct (non-pooled) host
  $env:PGCONNECT_TIMEOUT = '30'

  $stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
  $jFile = Join-Path $Dest "journal_$stamp.dump"
  & "$PgBin\pg_dump.exe" --dbname=$url -Fc -Z 9 --no-owner --no-privileges `
      --exclude-table-data=bars_1m --exclude-table-data=scan_cache -f $jFile
  if ($LASTEXITCODE -ne 0) { throw "pg_dump (journal) exited with $LASTEXITCODE" }
  $items = (& "$PgBin\pg_restore.exe" --list $jFile | Measure-Object -Line).Lines
  if ($LASTEXITCODE -ne 0 -or $items -lt 20) { throw "journal dump failed the integrity check ($items items)" }
  Write-Log ("OK journal {0} ({1:N1} MB, {2} items)" -f (Split-Path $jFile -Leaf), ((Get-Item $jFile).Length / 1MB), $items)

  # bars: dump only when they changed and the last bars dump is old enough
  $st = if (Test-Path $State) { Get-Content $State -Raw | ConvertFrom-Json } else { [pscustomobject]@{ barsMax = ''; barsAt = '' } }
  $barsMax = (& "$PgBin\psql.exe" $url -At -c "SELECT COALESCE(MAX(ts)::text, '') FROM bars_1m").Trim()
  if ($LASTEXITCODE -ne 0) { throw "psql (bars check) exited with $LASTEXITCODE" }
  $old = $true
  if ($st.barsAt) { $old = ((Get-Date) - [datetime]$st.barsAt).TotalDays -ge 28 }
  if ($ForceBars -or ($barsMax -ne $st.barsMax -and $old)) {
    $bFile = Join-Path $Dest "bars_$stamp.dump"
    & "$PgBin\pg_dump.exe" --dbname=$url -Fc -Z 9 --no-owner --no-privileges -t bars_1m -f $bFile
    if ($LASTEXITCODE -ne 0) { throw "pg_dump (bars) exited with $LASTEXITCODE" }
    & "$PgBin\pg_restore.exe" --list $bFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "bars dump failed the integrity check" }
    Write-Log ("OK bars {0} ({1:N1} MB, last bar {2})" -f (Split-Path $bFile -Leaf), ((Get-Item $bFile).Length / 1MB), $barsMax)
    $st = [pscustomobject]@{ barsMax = $barsMax; barsAt = (Get-Date).ToString('s') }
  } else {
    Write-Log "bars unchanged or dumped < 28 days ago (last bar $barsMax) - skipped"
  }
  $st | ConvertTo-Json | Set-Content -Path $State -Encoding utf8

  # retention
  Get-ChildItem $Dest -Filter 'journal_*.dump' | Sort-Object Name -Descending | Select-Object -Skip 8 | Remove-Item -Force
  Get-ChildItem $Dest -Filter 'bars_*.dump'    | Sort-Object Name -Descending | Select-Object -Skip 2 | Remove-Item -Force
  Set-Content -Path (Join-Path $Dest 'LAST_OK.txt') -Value ("Last good backup: {0:yyyy-MM-dd HH:mm}" -f (Get-Date)) -Encoding utf8
} catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  Set-Content -Path (Join-Path $Dest 'LAST_FAILED.txt') -Value ("{0:yyyy-MM-dd HH:mm} {1}" -f (Get-Date), $_.Exception.Message) -Encoding utf8
  exit 1
}
