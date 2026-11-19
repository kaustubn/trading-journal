# Restores a journal backup (and optionally a bars backup) into an EMPTY Postgres database.
# Neon writes its own column option (pg_attver) into dumps; standard Postgres rejects it, so those lines
# are removed before loading. Works for a local test database or a new Neon database.
# Usage: powershell -ExecutionPolicy Bypass -File restore.ps1 -Target "postgresql://.../emptydb" `
#          [-Journal path\journal_X.dump] [-Bars path\bars_X.dump]
# Without -Journal / -Bars the newest files in OneDrive\JournalBackups are used.
# After loading into a new database, point DATABASE_URL on Render at it and restart the service.
param([Parameter(Mandatory = $true)][string]$Target, [string]$Journal, [string]$Bars, [switch]$NoBars)
$ErrorActionPreference = 'Stop'
$PgBin = 'C:\Program Files\PostgreSQL\18\bin'
$Dir = Join-Path $env:USERPROFILE 'OneDrive\JournalBackups'
if (-not $Journal) { $Journal = (Get-ChildItem $Dir -Filter 'journal_*.dump' | Sort-Object Name -Descending | Select-Object -First 1).FullName }
if (-not $Bars -and -not $NoBars) { $f = Get-ChildItem $Dir -Filter 'bars_*.dump' | Sort-Object Name -Descending | Select-Object -First 1; if ($f) { $Bars = $f.FullName } }
if (-not $Journal) { throw "No journal backup found in $Dir" }

function Restore-Dump($file, [string[]]$extra) {
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    & "$PgBin\pg_restore.exe" --no-owner --no-privileges @extra -f $tmp $file
    if ($LASTEXITCODE -ne 0) { throw "pg_restore could not read $file" }
    $clean = "$tmp.sql"
    # strict UTF-8 in and out, no BOM, Unix newlines (Windows PowerShell 5.1 defaults to ANSI and garbles
    # characters such as "·" and "→" in trade notes)
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $reader = New-Object System.IO.StreamReader($tmp, $utf8)
    $writer = New-Object System.IO.StreamWriter($clean, $false, $utf8)
    $writer.NewLine = "`n"
    try {
      while ($null -ne ($line = $reader.ReadLine())) { if ($line -notmatch 'SET \(pg_attver=') { $writer.WriteLine($line) } }
    } finally { $reader.Close(); $writer.Close() }
    & "$PgBin\psql.exe" $Target -q -v ON_ERROR_STOP=1 -f $clean
    if ($LASTEXITCODE -ne 0) { throw "psql failed while loading $file" }
    Remove-Item $clean -Force
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

Write-Output "Loading journal: $Journal"
Restore-Dump $Journal @()
if ($Bars) { Write-Output "Loading bars: $Bars"; Restore-Dump $Bars @('--data-only') }
Write-Output 'Restore finished. Row counts:'
& "$PgBin\psql.exe" $Target -At -c "SELECT 'accounts', count(*) FROM accounts UNION ALL SELECT 'trades', count(*) FROM trades UNION ALL SELECT 'bars_1m', count(*) FROM bars_1m"
